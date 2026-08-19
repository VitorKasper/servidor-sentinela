// Conexão global Socket.IO para atualizações de status em tempo real
const socket = io();

socket.on('connect', () => {
  console.log('[Socket] Conectado ao servidor Sentinela. ID:', socket.id);
});

// Atualização de status de qualquer projeto em tempo real
socket.on('project_status', (data) => {
  const { projectId, status, pid } = data;
  console.log(`[Socket] Atualização de status do Projeto #${projectId}: ${status} (PID: ${pid || 'N/A'})`);

  // Atualiza pílula de status na UI se existir
  const statusPills = document.querySelectorAll(`[data-project-status-id="${projectId}"]`);
  statusPills.forEach(pill => {
    pill.className = `status-pill status-${status}`;
    pill.innerHTML = `<span class="status-dot"></span> <span class="status-text">${status}</span>`;
  });

  // Atualiza PID na UI se existir
  const pidElements = document.querySelectorAll(`[data-project-pid-id="${projectId}"]`);
  pidElements.forEach(el => {
    el.textContent = pid ? `#${pid}` : 'Inativo';
  });

  // Atualiza botões de ação se estiver na tela do terminal
  if (typeof updateTerminalControls === 'function') {
    updateTerminalControls(status);
  }
});

// Atualização de Identidade da Empresa em tempo real
function updateFavicon(initial) {
  const dynamicFavicon = document.getElementById('dynamicFavicon');
  if (dynamicFavicon) {
    const char = (initial && initial.trim()) ? initial.trim().charAt(0).toUpperCase() : 'S';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='24' fill='%23080c14'/><path d='M50 12 L85 28 L85 68 L50 88 L15 68 L15 28 Z' fill='none' stroke='%2300f0ff' stroke-width='6'/><text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle' fill='%2300f0ff' font-family='sans-serif' font-size='38' font-weight='800'>${char}</text></svg>`;
    dynamicFavicon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}

socket.on('company_updated', (data) => {
  const { companyName, companyTag, companyLogoUrl } = data;
  console.log(`[Socket] Marca da Empresa atualizada para: '${companyName}' (${companyTag}) Logo: ${companyLogoUrl}`);

  const initial = companyName ? companyName.charAt(0).toUpperCase() : 'S';

  // Atualiza favicon da aba do navegador
  const dynamicFavicon = document.getElementById('dynamicFavicon');
  if (dynamicFavicon) {
    if (companyLogoUrl) {
      dynamicFavicon.href = companyLogoUrl;
    } else {
      updateFavicon(initial);
    }
  }

  // Atualiza título da aba do navegador
  if (document.title.includes('-')) {
    const parts = document.title.split('-');
    document.title = `${parts[0].trim()} - ${companyName}`;
  } else {
    document.title = companyName;
  }

  // Atualiza Sidebar Logo Slot
  const logoWrapper = document.getElementById('sidebarLogoWrapper');
  if (logoWrapper) {
    if (companyLogoUrl) {
      logoWrapper.innerHTML = `
        <div class="brand-img-box" id="sidebarImgBox">
          <img src="${companyLogoUrl}" id="sidebarLogoImg" class="brand-custom-logo-img" alt="Logo da Empresa">
          <div class="brand-img-overlay">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </div>
        </div>
      `;
    } else {
      logoWrapper.innerHTML = `
        <div class="brand-dashed-slot" id="sidebarDashedSlot" title="Nenhuma logo enviada. Clique para fazer upload (+)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </div>
      `;
    }
  }

  // Atualiza Sidebar Textos
  const sidebarName = document.getElementById('sidebarBrandName');
  if (sidebarName) sidebarName.textContent = companyName;

  const sidebarTag = document.getElementById('sidebarBrandTag');
  if (sidebarTag) sidebarTag.textContent = companyTag;

  // Atualiza inputs no modal se aberto
  const inputName = document.getElementById('inputCompanyName');
  if (inputName) inputName.value = companyName;

  const inputTag = document.getElementById('inputCompanyTag');
  if (inputTag) inputTag.value = companyTag;
});
