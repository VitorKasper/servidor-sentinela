// Utilitários de interface geral
document.addEventListener('DOMContentLoaded', () => {
  // Auto dismiss de alertas flash após 5 segundos
  const alerts = document.querySelectorAll('.alert');
  alerts.forEach(alert => {
    setTimeout(() => {
      alert.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      alert.style.opacity = '0';
      alert.style.transform = 'translateY(-10px)';
      setTimeout(() => alert.remove(), 500);
    }, 5000);
  });

  // Confirmação para exclusões
  const deleteForms = document.querySelectorAll('.confirm-delete-form');
  deleteForms.forEach(form => {
    form.addEventListener('submit', (e) => {
      const confirmText = form.getAttribute('data-confirm-text') || 'Tem certeza que deseja prosseguir com a exclusão?';
      if (!confirm(confirmText)) {
        e.preventDefault();
      }
    });
  });

  // Modal de Personalização da Empresa & Upload de Logo
  const companyModal = document.getElementById('companyModal');
  const btnCloseCompanyModal = document.getElementById('btnCloseCompanyModal');
  const btnCancelCompanyModal = document.getElementById('btnCancelCompanyModal');
  const formUpdateCompany = document.getElementById('formUpdateCompany');

  const sidebarLogoWrapper = document.getElementById('sidebarLogoWrapper');
  const sidebarBrandText = document.querySelector('.brand-text-wrapper');

  const logoDropzone = document.getElementById('logoDropzone');
  const inputLogoFile = document.getElementById('inputLogoFile');
  const logoDropzoneEmpty = document.getElementById('logoDropzoneEmpty');
  const logoDropzoneFilled = document.getElementById('logoDropzoneFilled');
  const logoPreviewImg = document.getElementById('logoPreviewImg');
  const btnChangeLogo = document.getElementById('btnChangeLogo');
  const btnRemoveLogo = document.getElementById('btnRemoveLogo');
  const inputRemoveLogo = document.getElementById('inputRemoveLogo');

  function openCompanyModal() {
    if (companyModal) {
      companyModal.style.display = 'flex';
      const inputName = document.getElementById('inputCompanyName');
      if (inputName) inputName.focus();
    }
  }

  function closeCompanyModal() {
    if (companyModal) {
      companyModal.style.display = 'none';
    }
  }

  // Abre modal ao clicar no slot tracejado (+) ou no texto da sidebar
  if (sidebarLogoWrapper) sidebarLogoWrapper.addEventListener('click', openCompanyModal);
  if (sidebarBrandText) sidebarBrandText.addEventListener('click', openCompanyModal);
  if (btnCloseCompanyModal) btnCloseCompanyModal.addEventListener('click', closeCompanyModal);
  if (btnCancelCompanyModal) btnCancelCompanyModal.addEventListener('click', closeCompanyModal);

  if (companyModal) {
    companyModal.addEventListener('click', (e) => {
      if (e.target === companyModal) closeCompanyModal();
    });
  }

  // Upload e Seleção de Arquivo no Modal
  if (logoDropzone && inputLogoFile) {
    logoDropzone.addEventListener('click', (e) => {
      if (e.target !== btnRemoveLogo && e.target !== btnChangeLogo) {
        inputLogoFile.click();
      }
    });

    if (btnChangeLogo) {
      btnChangeLogo.addEventListener('click', (e) => {
        e.stopPropagation();
        inputLogoFile.click();
      });
    }

    if (btnRemoveLogo) {
      btnRemoveLogo.addEventListener('click', (e) => {
        e.stopPropagation();
        inputLogoFile.value = '';
        inputRemoveLogo.value = 'true';
        logoPreviewImg.src = '';
        logoDropzoneFilled.style.display = 'none';
        logoDropzoneEmpty.style.display = 'block';
      });
    }

    inputLogoFile.addEventListener('change', () => {
      const file = inputLogoFile.files[0];
      if (file) {
        inputRemoveLogo.value = 'false';
        const reader = new FileReader();
        reader.onload = (e) => {
          logoPreviewImg.src = e.target.result;
          logoDropzoneEmpty.style.display = 'none';
          logoDropzoneFilled.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Submissão com FormData (Suporte a Arquivos de Imagem)
  if (formUpdateCompany) {
    formUpdateCompany.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputName = document.getElementById('inputCompanyName');
      const btnSave = document.getElementById('btnSaveCompany');

      if (!inputName || !inputName.value.trim()) {
        alert('Por favor, informe o nome da empresa.');
        return;
      }

      btnSave.disabled = true;
      btnSave.innerText = 'Salvando e Atualizando...';

      const formData = new FormData(formUpdateCompany);

      try {
        const response = await fetch('/api/settings/company', {
          method: 'POST',
          headers: {
            'Accept': 'application/json'
          },
          body: formData
        });

        const data = await response.json();
        if (data.success) {
          closeCompanyModal();
        } else {
          alert(`Erro ao salvar: ${data.error || 'Falha ao salvar'}`);
        }
      } catch (err) {
        console.error('Erro ao atualizar empresa:', err);
        alert('Falha na comunicação com o servidor ao atualizar logo e empresa.');
      } finally {
        btnSave.disabled = false;
        btnSave.innerText = 'Salvar Alterações';
      }
    });
  }
});
