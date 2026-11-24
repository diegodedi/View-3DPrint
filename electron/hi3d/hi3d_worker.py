#!/usr/bin/env python3
"""Unified 1-image local 3D pipeline: rembg -> Hunyuan3D-2 mini -> Hi3D v1.0 (Sparc3D) -> STL/OBJ."""

from __future__ import annotations

import argparse
import gc
import json
import os
import sys
import time
from pathlib import Path

EVENT_PREFIX = "@@HI3D_EVENT@@"


def emit(stage: str, percent: int, message: str, **extra) -> None:
    payload = {"stage": stage, "percent": percent, "message": message, **extra}
    print(f"{EVENT_PREFIX}{json.dumps(payload, ensure_ascii=False)}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--hunyuan-repo", type=Path, required=True)
    parser.add_argument("--hf-cache", type=Path, required=True)
    parser.add_argument("--resolution", type=int, choices=(512, 1024, 1536), default=512)
    parser.add_argument("--target-size-mm", type=float, default=100.0)
    parser.add_argument("--steps", type=int, default=25)
    parser.add_argument("--coarse-steps", type=int, default=25)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--remove-background", action="store_true")
    parser.add_argument("--cpu-offload", action="store_true")
    return parser.parse_args()


def configure_hf_env(hf_cache: Path) -> Path:
    hub_dir = hf_cache / "hub"
    hub_dir.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(hf_cache)
    os.environ["HF_HUB_CACHE"] = str(hub_dir)
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(hub_dir)
    return hub_dir


def prepare_image(image_path: Path, should_remove_bg: bool):
    from PIL import Image

    image = Image.open(image_path)
    if should_remove_bg:
        emit("preparing", 8, "Removendo fundo da imagem (rembg)...")
        from sparc3d.utils.image import remove_background

        image = remove_background(image)
    return image


def run_coarse_stage(image, hunyuan_repo: Path, coarse_steps: int, seed: int):
    import torch

    sys.path.insert(0, str(hunyuan_repo))
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

    emit("coarse", 18, "Carregando Estágio 1 (Hunyuan3D-2 mini turbo)...")
    generator = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        "tencent/Hunyuan3D-2mini",
        subfolder="hunyuan3d-dit-v2-mini-turbo",
        use_safetensors=True,
        device="cuda",
    )
    emit("coarse", 28, "Gerando malha 3D base a partir da imagem...")
    coarse_mesh = generator(
        image=image,
        num_inference_steps=coarse_steps,
        octree_resolution=256,
        generator=torch.manual_seed(seed),
        output_type="trimesh",
    )[0]
    emit("freeing_vram", 42, "Liberando VRAM do Estágio 1 para o refinamento Hi3D...")
    try:
        generator.to("cpu")
    except Exception:
        pass
    del generator
    gc.collect()
    torch.cuda.empty_cache()
    return coarse_mesh


def run_hi3d_refine(image, coarse_mesh, hub_dir: Path, resolution: int, steps: int, seed: int, cpu_offload: bool):
    from sparc3d import Sparc3DPipeline

    def on_step(event) -> None:
        total = max(1, event.num_passes * event.num_inference_steps)
        done = event.pass_index * event.num_inference_steps + event.step
        pct = 50 + int((done / total) * 40)
        emit(
            "refining",
            min(90, pct),
            f"Refinando geometria Hi3D ({resolution}³) — passe {event.pass_index + 1}/{event.num_passes}, passo {event.step}/{event.num_inference_steps}",
        )

    emit("refining", 46, "Carregando Hi3D v1.0 (na 1ª execução baixa os pesos do Hugging Face)...")
    pipeline = Sparc3DPipeline.from_pretrained(
        "hi3d-official/Hi3Dv1.0",
        cache_dir=hub_dir,
        progress_callback=on_step,
    )
    if cpu_offload:
        pipeline.enable_sequential_cpu_offload("cuda")
    else:
        pipeline.to("cuda")

    emit("refining", 50, f"Esculpindo detalhes em alta resolução ({resolution}³)...")
    return pipeline(
        image,
        coarse_mesh,
        resolution=resolution,
        num_inference_steps=steps,
        seed=seed,
    )


def scale_for_printing(mesh, target_size_mm: float):
    bounds = mesh.bounds
    extents = bounds[1] - bounds[0]
    max_extent = float(extents.max())
    if max_extent > 1e-6:
        scale_factor = target_size_mm / max_extent
        mesh.apply_scale(scale_factor)
    bounds = mesh.bounds
    center_xy = (bounds[0][:2] + bounds[1][:2]) * 0.5
    mesh.apply_translation([-float(center_xy[0]), -float(center_xy[1]), -float(bounds[0][2])])
    return mesh


def main() -> int:
    started = time.time()
    args = parse_args()
    hub_dir = configure_hf_env(args.hf_cache)

    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("GPU NVIDIA CUDA não detectada no ambiente Python.")

    emit("preparing", 4, f"Iniciando na GPU {torch.cuda.get_device_name(0)}...")
    image = prepare_image(args.image, args.remove_background)
    coarse_mesh = run_coarse_stage(image, args.hunyuan_repo, args.coarse_steps, args.seed)
    result = run_hi3d_refine(
        image,
        coarse_mesh,
        hub_dir,
        args.resolution,
        args.steps,
        args.seed,
        args.cpu_offload,
    )

    emit("exporting", 94, f"Ajustando escala ({int(args.target_size_mm)} mm) e exportando arquivo 3D...")
    mesh = scale_for_printing(result.mesh, args.target_size_mm)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(args.output))

    elapsed_ms = int((time.time() - started) * 1000)
    triangles = int(len(mesh.faces)) if hasattr(mesh, "faces") else 0
    emit(
        "done",
        100,
        f"Modelo 3D gerado com sucesso ({triangles:,} triângulos)!",
        triangles=triangles,
        elapsedMs=elapsed_ms,
        resolution=int(result.resolution),
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"HI3D_ERROR: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
