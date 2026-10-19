(function () {
  const vscode = acquireVsCodeApi();

  const form = document.getElementById('serverForm');
  const formTitle = document.getElementById('formTitle');
  const statusBanner = document.getElementById('statusBanner');

  const profileIdInput = document.getElementById('profileId');
  const nameInput = document.getElementById('name');
  const baseUrlInput = document.getElementById('baseUrl');
  const organizationInput = document.getElementById('organization');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const passwordHint = document.getElementById('passwordHint');

  const testServerBtn = document.getElementById('testServerBtn');
  const saveServerBtn = document.getElementById('saveServerBtn');

  function showStatus(message, type) {
    if (!statusBanner) {
      return;
    }
    statusBanner.textContent = message;
    statusBanner.className = 'status-banner status-' + (type || 'info');
  }

  function clearStatus() {
    if (!statusBanner) {
      return;
    }
    statusBanner.textContent = '';
    statusBanner.className = 'status-banner hidden';
  }

  function collectFormPayload() {
    return {
      id: profileIdInput.value || undefined,
      name: nameInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      organization: organizationInput.value.trim() || undefined,
      username: usernameInput.value.trim(),
      password: passwordInput.value
    };
  }

  function validateForm(payload, isSave) {
    if (isSave && !payload.name) {
      showStatus('Informe o Nome do Perfil.', 'error');
      nameInput.focus();
      return false;
    }

    if (!payload.baseUrl) {
      showStatus('Informe a URL Base do JasperServer.', 'error');
      baseUrlInput.focus();
      return false;
    }

    if (!/^https?:\/\/.+/i.test(payload.baseUrl)) {
      showStatus('A URL Base deve iniciar com http:// ou https://.', 'error');
      baseUrlInput.focus();
      return false;
    }

    if (!payload.username) {
      showStatus('Informe o Usuário de acesso ao JasperServer.', 'error');
      usernameInput.focus();
      return false;
    }

    clearStatus();
    return true;
  }

  testServerBtn.addEventListener('click', function () {
    const payload = collectFormPayload();
    if (!validateForm(payload, false)) {
      return;
    }

    showStatus('Testando comunicação com o JasperServer...', 'info');
    testServerBtn.disabled = true;

    vscode.postMessage({
      command: 'testConnection',
      payload: payload
    });
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const payload = collectFormPayload();
    if (!validateForm(payload, true)) {
      return;
    }

    saveServerBtn.disabled = true;
    vscode.postMessage({
      command: 'saveServer',
      payload: payload
    });
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || !message.command) {
      return;
    }

    switch (message.command) {
      case 'loadProfile': {
        const profile = message.profile;
        clearStatus();
        saveServerBtn.disabled = false;
        testServerBtn.disabled = false;

        if (profile) {
          formTitle.textContent = 'Editar Servidor: ' + profile.name;
          profileIdInput.value = profile.id || '';
          nameInput.value = profile.name || '';
          baseUrlInput.value = profile.baseUrl || '';
          organizationInput.value = profile.organization || '';
          usernameInput.value = profile.username || '';
          passwordInput.value = '';

          if (message.hasSavedPassword) {
            passwordInput.placeholder = '•••••••• (Deixe em branco para manter a senha atual)';
            passwordHint.textContent =
              'Senha já salva no SecretStorage. Preencha apenas se desejar alterá-la.';
          } else {
            passwordInput.placeholder = 'Digite a senha do servidor';
            passwordHint.textContent =
              'Armazenada com criptografia via VS Code SecretStorage.';
          }
        } else {
          formTitle.textContent = 'Novo Servidor JasperServer';
          profileIdInput.value = '';
          nameInput.value = '';
          baseUrlInput.value = 'http://localhost:8080/jasperserver';
          organizationInput.value = '';
          usernameInput.value = 'jasperadmin';
          passwordInput.value = '';
          passwordInput.placeholder = 'Digite a senha do servidor';
          passwordHint.textContent =
            'Armazenada com criptografia via VS Code SecretStorage.';
        }
        break;
      }

      case 'testResult': {
        testServerBtn.disabled = false;
        showStatus(message.message, message.success ? 'success' : 'error');
        break;
      }

      case 'saveError': {
        saveServerBtn.disabled = false;
        showStatus(message.message || 'Erro ao salvar o servidor.', 'error');
        break;
      }
    }
  });

  vscode.postMessage({ command: 'ready' });
})();
