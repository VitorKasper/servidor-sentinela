# 🛡️ Servidor Sentinela

Sistema completo de gerenciamento de deploys, servidor de processos e painel de controle via rede local (**LAN**), construído com arquitetura **MVC** em **Node.js**, **Express**, **EJS**, **Sequelize**, **MySQL** e **Socket.IO**.

---

## 🚀 Funcionalidades Principais

### 👑 Visão do Administrador (Admin)
- **Importação do GitHub**: Cadastre repositórios públicos ou privados (com Personal Access Token).
- **Configuração de Deploys**: Defina branch, comandos de instalação (`npm install`), build e inicialização (`npm start`), além de variáveis de ambiente (`.env`) e alocação de portas exclusivas.
- **Deploy Inicial Automatizado**: O servidor clona o repositório em `storage/projects/<slug>`, instala dependências e inicia o serviço automaticamente.
- **Gestão de Operadores**: Cadastre novos operadores e administradores para operação do sistema.

### 💻 Visão do Operador (Operator)
- **Terminal & Logs em Tempo Real**: Console estilo hacker/datacenter com streaming via WebSocket (`Socket.IO`).
- **Controle Total de Processos**:
  - ▶️ **Iniciar (Start)**: Executa o processo do projeto.
  - ⏹️ **Parar (Stop)**: Encerra com segurança a árvore de processos do projeto (`tree-kill`).
  - 🔄 **Reiniciar (Restart)**: Reinicia a aplicação ativa.
  - 🚀 **Re-Deploy (Git Pull + Build + Start)**: Puxa as últimas alterações da branch do GitHub, atualiza dependências e reinicia o serviço.
- **Monitoramento LAN**: Acesso direto ao endereço IP da máquina na rede local com links diretos para as portas das aplicações hospedadas.

### 🌐 Monitor de Portas Ocupadas & Sugestão Inteligente
- **Escaneamento do Sistema**: Identifica todas as portas TCP ativas no sistema operacional com os respectivos PIDs e nomes dos serviços (MySQL, Web Servers, etc.).
- **Identificação de Projetos Sentinela**: Cruza as portas ativas e reservadas com os projetos cadastrados no banco de dados.
- **⚡ Sugestão de Porta Livre**: Botão que descobre e sugere automaticamente a próxima porta TCP disponível para alocar em novos projetos.
- **Validação em Tempo Real**: Feedback dinâmico enquanto digita a porta no formulário.

---

## 📂 Estrutura do Projeto (Padrão MVC)

```
servidor-sentinela/
├── config/
│   ├── database.js          # Conexão Sequelize e auto-criação do MySQL
│   └── network.js           # Utilitário de detecção de IPv4 na LAN
├── controllers/
│   ├── authController.js    # Login e controle de sessão
│   ├── dashboardController.js# Métricas gerais, hardware e status
│   ├── projectController.js # CRUD, clonagem do Git e parametrização
│   ├── processController.js # Comandos de Start/Stop/Restart/Redeploy
│   └── userController.js    # Gestão de usuários e permissões
├── middleware/
│   ├── authMiddleware.js    # Proteção de rotas autenticadas
│   └── roleMiddleware.js    # Controle por papéis (ADMIN e OPERATOR)
├── models/
│   ├── index.js             # Sincronização e seeds padrão
│   ├── User.js              # Modelo de Usuários com hash bcrypt
│   ├── Project.js           # Modelo de Projetos e configurações
│   └── DeploymentLog.js     # Histórico de deploys
├── public/
│   ├── css/
│   │   └── main.css         # Design system (Dark Mode Sentinela, Glassmorphism)
│   └── js/
│       ├── socket-client.js # Sincronização de status via Socket.IO
│       ├── terminal-view.js # Terminal ao vivo e comandos do operador
│       └── main.js          # Interações de UI
├── routes/
│   ├── authRoutes.js        # /auth/login, /auth/logout
│   ├── dashboardRoutes.js   # /dashboard
│   ├── projectRoutes.js     # /projects (CRUD)
│   ├── processRoutes.js     # /projects/:id/terminal, start, stop, restart, redeploy
│   └── userRoutes.js        # /users (Gestão de operadores)
├── services/
│   ├── gitService.js        # Clonagem, checkout e pull do GitHub
│   └── processManager.js    # Gerenciador de subprocessos e stream de logs
├── storage/
│   └── projects/            # Diretório isolado das aplicações clonadas
├── views/                   # Templates EJS modernos e responsivos
├── server.js                # Ponto de entrada HTTP + Socket.IO (0.0.0.0)
└── .env                     # Variáveis de configuração
```

---

## 🛠️ Como Executar

### 1. Pré-requisitos
- **Node.js** (v18+)
- **Git** instalado e configurado no PATH
- **MySQL** rodando localmente (ex: XAMPP, MySQL Workbench, Docker)

### 2. Configurar o `.env`
O arquivo `.env` já vem pré-configurado por padrão:
```env
PORT=3000
HOST=0.0.0.0
SESSION_SECRET=sentinela_super_secret_session_key_2026

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASS=
DB_NAME=servidor_sentinela
```

### 3. Iniciar o Servidor
```bash
npm start
```
ou em modo de desenvolvimento com hot-reload:
```bash
npm run dev
```

---

## 🔑 Credenciais Padrão (Criadas no 1º Boot)

| Papel | E-mail | Senha |
|---|---|---|
| **Administrador** | `admin@sentinela.local` | `admin123` |
| **Operador** | `operador@sentinela.local` | `operador123` |

---

## 🌐 Acesso em Rede Local (LAN)

O servidor se conecta em `0.0.0.0`, permitindo que qualquer dispositivo na mesma rede acesse através de:
```
http://<IP_DO_SERVIDOR>:3000
```
*(O IP exato da sua máquina é exibido automaticamente no console do terminal e no topo do painel web).*
