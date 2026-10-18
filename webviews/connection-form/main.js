(function () {
  const vscode = acquireVsCodeApi();

  const form = document.getElementById('connectionForm');
  const formTitle = document.getElementById('formTitle');
  const statusBanner = document.getElementById('statusBanner');

  const profileIdInput = document.getElementById('profileId');
  const nameInput = document.getElementById('name');
  const driverSelect = document.getElementById('driver');
  const customDriverSection = document.getElementById('customDriverSection');
  const customDriverPathInput = document.getElementById('customDriverPath');
  const customDriverClassInput = document.getElementById('customDriverClass');
  const jdbcUrlInput = document.getElementById('jdbcUrl');
  const browseJarBtn = document.getElementById('browseJarBtn');

  const hostInput = document.getElementById('host');
  const portInput = document.getElementById('port');
  const databaseInput = document.getElementById('database');
  const userInput = document.getElementById('user');
  const passwordInput = document.getElementById('password');
  const passwordHint = document.getElementById('passwordHint');

  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const saveConnectionBtn = document.getElementById('saveConnectionBtn');

  let lastDefaultPort = '5432';

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

  function updateDriverUI(driver, preservePort) {
    const isCustom = driver === 'custom';
    if (isCustom) {
      customDriverSection.classList.remove('hidden');
      customDriverPathInput.setAttribute('required', 'required');
      customDriverClassInput.setAttribute('required', 'required');
    } else {
      customDriverSection.classList.add('hidden');
      customDriverPathInput.removeAttribute('required');
      customDriverClassInput.removeAttribute('required');
    }

    const defaultPort = driver === 'postgres' ? '5432' : driver === 'oracle' ? '1521' : '';
    if (defaultPort) {
      portInput.placeholder = defaultPort;
      if (!preservePort && (!portInput.value || portInput.value === lastDefaultPort)) {
        portInput.value = defaultPort;
      }
      lastDefaultPort = defaultPort;
    } else {
      portInput.placeholder = 'Porta';
    }
  }

  function collectFormPayload() {
    const driver = driverSelect.value;
    const rawPort = portInput.value ? parseInt(portInput.value, 10) : undefined;

    return {
      id: profileIdInput.value || undefined,
      name: nameInput.value.trim(),
      driver: driver,
      host: hostInput.value.trim(),
      port: Number.isFinite(rawPort) ? rawPort : undefined,
      database: databaseInput.value.trim(),
      user: userInput.value.trim(),
      password: passwordInput.value,
      customDriverPath: driver === 'custom' ? customDriverPathInput.value.trim() : undefined,
      customDriverClass: driver === 'custom' ? customDriverClassInput.value.trim() : undefined,
      jdbcUrl: driver === 'custom' ? jdbcUrlInput.value.trim() : undefined
    };
  }

  function validateForm(payload, isSave) {
    if (isSave && !payload.name) {
      showStatus('Informe o Nome da Conexão.', 'error');
      nameInput.focus();
      return false;
    }

    if (payload.driver === 'custom') {
      if (!payload.customDriverPath) {
        showStatus('Selecione o arquivo .jar para o driver personalizado.', 'error');
        customDriverPathInput.focus();
        return false;
      }
      if (!payload.customDriverClass) {
        showStatus('Informe o nome da classe do driver JDBC personalizado.', 'error');
        customDriverClassInput.focus();
        return false;
      }
    }

    if (!payload.jdbcUrl) {
      if (!payload.host) {
        showStatus('Informe o Host do banco de dados.', 'error');
        hostInput.focus();
        return false;
      }
      if (!payload.port || payload.port < 1 || payload.port > 65535) {
        showStatus('Informe uma Porta válida (1 a 65535).', 'error');
        portInput.focus();
        return false;
      }
      if (!payload.database) {
        showStatus('Informe o nome do Database / Service Name.', 'error');
        databaseInput.focus();
        return false;
      }
    }

    if (!payload.user) {
      showStatus('Informe o Usuário de acesso ao banco.', 'error');
      userInput.focus();
      return false;
    }

    clearStatus();
    return true;
  }

  driverSelect.addEventListener('change', function () {
    updateDriverUI(driverSelect.value, false);
  });

  browseJarBtn.addEventListener('click', function () {
    vscode.postMessage({
      command: 'browseJar'
    });
  });

  testConnectionBtn.addEventListener('click', function () {
    const payload = collectFormPayload();
    if (!validateForm(payload, false)) {
      return;
    }

    showStatus('Testando conexão com o banco de dados...', 'info');
    testConnectionBtn.disabled = true;

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

    saveConnectionBtn.disabled = true;
    vscode.postMessage({
      command: 'saveConnection',
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
        saveConnectionBtn.disabled = false;
        testConnectionBtn.disabled = false;

        if (profile) {
          formTitle.textContent = 'Editar Conexão: ' + profile.name;
          profileIdInput.value = profile.id || '';
          nameInput.value = profile.name || '';
          driverSelect.value = profile.driver || 'postgres';
          hostInput.value = profile.host || '';
          portInput.value = profile.port ? String(profile.port) : '';
          databaseInput.value = profile.database || '';
          userInput.value = profile.user || '';
          customDriverPathInput.value = profile.customDriverPath || '';
          customDriverClassInput.value = profile.customDriverClass || '';
          jdbcUrlInput.value = profile.jdbcUrl || '';
          passwordInput.value = message.password || '';

          if (message.hasSavedPassword && !message.password) {
            passwordInput.placeholder = '•••••••• (Deixe em branco para manter a senha atual)';
            passwordHint.textContent = 'Senha já salva no SecretStorage. Preencha apenas se desejar alterá-la.';
          } else {
            passwordInput.placeholder = 'Digite a senha do banco';
            passwordHint.textContent = 'Armazenada com criptografia via VS Code SecretStorage.';
          }

          updateDriverUI(driverSelect.value, true);
        } else {
          formTitle.textContent = 'Nova Conexão de Banco de Dados';
          profileIdInput.value = '';
          nameInput.value = '';
          driverSelect.value = 'postgres';
          hostInput.value = 'localhost';
          portInput.value = '5432';
          databaseInput.value = '';
          userInput.value = '';
          passwordInput.value = '';
          customDriverPathInput.value = '';
          customDriverClassInput.value = '';
          jdbcUrlInput.value = '';
          passwordInput.placeholder = 'Digite a senha do banco';
          passwordHint.textContent = 'Armazenada com criptografia via VS Code SecretStorage.';

          updateDriverUI('postgres', true);
        }
        break;
      }

      case 'jarSelected': {
        if (message.path) {
          customDriverPathInput.value = message.path;
        }
        break;
      }

      case 'testResult': {
        testConnectionBtn.disabled = false;
        showStatus(message.message, message.success ? 'success' : 'error');
        break;
      }

      case 'saveError': {
        saveConnectionBtn.disabled = false;
        showStatus(message.message || 'Erro ao salvar a conexão.', 'error');
        break;
      }
    }
  });

  vscode.postMessage({ command: 'ready' });
})();
