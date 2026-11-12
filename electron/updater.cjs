const { dialog, app } = require('electron');
const { autoUpdater } = require('electron-updater');

let isManualCheck = false;
let isDownloadingUpdate = false;

function initAutoUpdater(mainWindow) {
  autoUpdater.logger = console;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Verificando atualizações no GitHub...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Nova versão encontrada:', info.version);
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;

    let notes = '';
    if (info.releaseNotes) {
      if (typeof info.releaseNotes === 'string') notes = info.releaseNotes;
      else if (Array.isArray(info.releaseNotes)) {
        notes = info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note || '')).join('\n');
      }
    }

    const detailText = notes
      ? `Novidades da versão v${info.version}:\n\n${notes}\n\nDeseja baixar a atualização agora?`
      : `Uma nova versão (v${info.version}) do View 3DPrint está disponível.\nVersão atual: v${app.getVersion()}.\n\nDeseja baixar a atualização agora?`;

    dialog
      .showMessageBox(win, {
        type: 'question',
        buttons: ['Atualizar Agora', 'Lembrar Mais Tarde'],
        defaultId: 0,
        cancelId: 1,
        title: 'Atualização Disponível',
        message: `Nova Versão Disponível: v${info.version}`,
        detail: detailText,
      })
      .then((result) => {
        if (result.response === 0) {
          isDownloadingUpdate = true;
          dialog.showMessageBox(win, {
            type: 'info',
            title: 'Baixando Atualização',
            message: `Iniciando o download da versão v${info.version}...`,
            detail: 'O download está sendo executado em segundo plano. Você será avisado quando estiver pronto para instalar.',
          });

          autoUpdater.downloadUpdate().catch((err) => {
            isDownloadingUpdate = false;
            console.error('[AutoUpdater] Falha no download:', err);
            dialog.showErrorBox('Erro no Download', `Não foi possível baixar a atualização: ${err.message || err}`);
          });
        }
      });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] Aplicativo já está na versão mais recente.');
    if (isManualCheck) {
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Sem Atualizações',
        message: 'Você já está usando a versão mais recente.',
        detail: `Versão atual instalada: v${app.getVersion()}`,
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Erro ao checar atualizações:', err);
    if (isManualCheck) {
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Verificação de Atualização',
        message: 'Não foi possível verificar atualizações no momento.',
        detail: err.message || 'Verifique sua conexão com a internet.',
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    isDownloadingUpdate = false;
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    dialog
      .showMessageBox(win, {
        type: 'info',
        buttons: ['Reiniciar e Instalar Agora', 'Mais Tarde'],
        defaultId: 0,
        cancelId: 1,
        title: 'Atualização Pronta',
        message: `Versão v${info.version} baixada com sucesso!`,
        detail: 'O View 3DPrint precisa ser reiniciado para aplicar a atualização. Deseja reiniciar agora?',
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  // Checagem automática no início (apenas quando empacotado em produção)
  if (app.isPackaged) {
    try {
      isManualCheck = false;
      autoUpdater.checkForUpdates();
    } catch (err) {
      console.error('[AutoUpdater] Falha na checagem inicial:', err);
    }
  }
}

function checkForUpdates(mainWindow, manual = true) {
  if (!app.isPackaged) {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Modo de Desenvolvimento',
      message: 'O auto-updater só opera no aplicativo compilado/instalado.',
      detail: `Versão atual do código: v${app.getVersion()}`,
    });
    return;
  }
  isManualCheck = manual;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[AutoUpdater] Erro ao disparar checkForUpdates manual:', err);
  });
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
};

