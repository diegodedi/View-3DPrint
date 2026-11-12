import React from 'react';
import type { CutPoint3D2D } from '../../utils/catpin/cutterMeshBuilder';

interface CatPinOverlay2DProps {
  isActive: boolean;
  isLoopClosed: boolean;
  points: CutPoint3D2D[];
  cursorPos: { x: number; y: number } | null;
  draggingIndex: number | null;
  onStartDragPoint: (index: number, e: React.PointerEvent<SVGCircleElement>) => void;
  onCloseLoop: () => void;
}

function buildSmoothCatmullRomSvgPath(pts: CutPoint3D2D[], closed: boolean): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (n === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}${closed ? ' Z' : ''}`;
  }

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  const count = closed ? n : n - 1;

  for (let i = 0; i < count; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    const cp1x = p1.x + (p2.x - (closed || i > 0 ? p0.x : p1.x)) / 6;
    const cp1y = p1.y + (p2.y - (closed || i > 0 ? p0.y : p1.y)) / 6;
    const cp2x = p2.x - ((closed || i + 2 < n ? p3.x : p2.x) - p1.x) / 6;
    const cp2y = p2.y - ((closed || i + 2 < n ? p3.y : p2.y) - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  if (closed) d += ' Z';
  return d;
}

/**
 * Overlay SVG 2D sobre o Canvas 3D: exibe curva Catmull-Rom suavizada, linha elástica e pontos arrastáveis.
 */
export const CatPinOverlay2D: React.FC<CatPinOverlay2DProps> = ({
  isActive,
  isLoopClosed,
  points,
  cursorPos,
  draggingIndex,
  onStartDragPoint,
  onCloseLoop,
}) => {
  if (!isActive || points.length === 0) {
    return null;
  }

  const lastPt = points[points.length - 1];
  const firstPt = points[0];
  const isNearFirstPoint =
    !isLoopClosed &&
    points.length >= 3 &&
    cursorPos !== null &&
    Math.hypot(cursorPos.x - firstPt.x, cursorPos.y - firstPt.y) < 12;

  const smoothClosedPath = buildSmoothCatmullRomSvgPath(points, true);
  const smoothOpenPath = buildSmoothCatmullRomSvgPath(points, false);

  return (
    <svg className="catpin-overlay-svg">
      {isLoopClosed && points.length >= 3 && (
        <path
          d={smoothClosedPath}
          fill="none"
          stroke="var(--color-overlay-line)"
          strokeWidth={2.2}
        />
      )}

      {!isLoopClosed && points.length >= 2 && (
        <path
          d={smoothOpenPath}
          fill="none"
          stroke="var(--color-overlay-line)"
          strokeWidth={2}
        />
      )}

      {!isLoopClosed && cursorPos && draggingIndex === null && (
        <line
          x1={lastPt.x}
          y1={lastPt.y}
          x2={cursorPos.x}
          y2={cursorPos.y}
          stroke="var(--color-overlay-line)"
          strokeWidth={1.8}
          strokeDasharray="5,4"
        />
      )}

      {!isLoopClosed &&
        cursorPos &&
        draggingIndex === null &&
        points.length >= 2 && (
          <line
            x1={cursorPos.x}
            y1={cursorPos.y}
            x2={firstPt.x}
            y2={firstPt.y}
            stroke="var(--color-overlay-line)"
            strokeOpacity={0.5}
            strokeWidth={1.4}
            strokeDasharray="4,4"
          />
        )}

      {isNearFirstPoint && (
        <circle
          cx={firstPt.x}
          cy={firstPt.y}
          r={12}
          fill="var(--color-overlay-fill)"
          stroke="var(--color-overlay-line)"
          strokeWidth={2}
        />
      )}

      {points.map((pt, idx) => {
        const nodeClass =
          idx === 0 && !isLoopClosed && points.length >= 3
            ? 'catpin-overlay-node-pointer'
            : draggingIndex === idx
            ? 'catpin-overlay-node-grabbing'
            : 'catpin-overlay-node';

        return (
          <circle
            key={idx}
            cx={pt.x}
            cy={pt.y}
            r={draggingIndex === idx ? 8 : idx === 0 && !isLoopClosed && points.length >= 3 ? 7 : 6}
            fill="var(--color-overlay-line)"
            stroke="var(--color-overlay-node-stroke)"
            strokeWidth={2}
            className={nodeClass}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (idx === 0 && !isLoopClosed && points.length >= 3) {
                onCloseLoop();
                return;
              }
              onStartDragPoint(idx, e);
            }}
          />
        );
      })}
    </svg>
  );
};
