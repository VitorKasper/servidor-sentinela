require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const flash = require('connect-flash');
const cors = require('cors');
const morgan = require('morgan');
const { Server } = require('socket.io');

const { ensureDatabaseExists } = require('./config/database');
const { syncAndSeed } = require('./models');
const { getLocalIpAddresses, getPrimaryLocalIp } = require('./config/network');

// Importação das rotas
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const projectRoutes = require('./routes/projectRoutes');
const processRoutes = require('./routes/processRoutes');
const userRoutes = require('./routes/userRoutes');
const portRoutes = require('./routes/portRoutes');
const settingRoutes = require('./routes/settingRoutes');
const settingService = require('./services/settingService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Armazena a instância do Socket.IO no app para acesso nos controllers/services
app.set('io', io);

// Middlewares Globais
app.use(cors());
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configuração da View Engine (EJS + Layouts)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Sessão e Flash Messages
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'sentinela_super_secret_session_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dias
    }
  })
);
app.use(flash());

// Middleware para variáveis globais nas views
app.use((req, res, next) => {
  res.locals.messages = {
    error: req.flash('error'),
    success: req.flash('success'),
    info: req.flash('info')
  };
  res.locals.currentUser = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.primaryIp = getPrimaryLocalIp();
  res.locals.serverPort = process.env.PORT || 3000;
  res.locals.companyName = settingService.getCompanyName();
  res.locals.companyTag = settingService.getCompanyTag();
  res.locals.companyLogoUrl = settingService.getCompanyLogoUrl();
  next();
});

// Registro de Rotas
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/projects', projectRoutes);
app.use('/projects', processRoutes);
app.use('/users', userRoutes);
app.use('/', portRoutes);
app.use('/', settingRoutes);

// Rota raiz redireciona para o dashboard
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/auth/login');
});

// Tratamento de 404
app.use((req, res) => {
  res.status(404).render('dashboard/index', {
    title: 'Página Não Encontrada',
    projects: [],
    stats: { total: 0, running: 0, stopped: 0, error: 0, building: 0, users: 0 },
    system: { memoryTotal: 0, memoryUsed: 0, memoryPercent: 0, cpus: 0, platform: '', uptimeHours: 0 },
    network: { localIps: [], primaryIp: 'localhost', serverPort: 3000 },
    recentLogs: []
  });
});

// Gerenciamento de conexões Socket.IO
io.on('connection', (socket) => {
  // Cliente entra na sala específica de um projeto para receber logs
  socket.on('join_project', (projectId) => {
    const room = `project:${projectId}`;
    socket.join(room);
  });

  socket.on('leave_project', (projectId) => {
    const room = `project:${projectId}`;
    socket.leave(room);
  });
});

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const autoSyncService = require('./services/autoSyncService');

async function startServer() {
  try {
    console.log('[Sentinela] Inicializando banco de dados...');
    await ensureDatabaseExists();
    await syncAndSeed();

    // Inicializa motor de Auto-Sync periódico para os projetos em segundo plano
    autoSyncService.startAutoSyncEngine(io, 30);

    server.listen(PORT, HOST, () => {
      const localIps = getLocalIpAddresses();
      const primaryIp = getPrimaryLocalIp();

      console.log('\n=============================================================');
      console.log('       🛡️  SERVIDOR SENTINELA INICIALIZADO COM SUCESSO        ');
      console.log('=============================================================');
      console.log(`  Local:        http://localhost:${PORT}`);
      console.log(`  LAN Primária: http://${primaryIp}:${PORT}`);
      if (localIps.length > 1) {
        console.log('  Outras Interfaces LAN:');
        localIps.forEach(ip => {
          if (ip.address !== primaryIp) {
            console.log(`    - ${ip.interface}: http://${ip.address}:${PORT}`);
          }
        });
      }
      // console.log('-------------------------------------------------------------');
      // console.log('  Credenciais Padrão de Acesso:');
      // console.log(`    - ADMIN:    ${process.env.DEFAULT_ADMIN_EMAIL || 'admin@sentinela.local'} / ${process.env.DEFAULT_ADMIN_PASSWORD || 'admin123'}`);
      // console.log(`    - OPERADOR: ${process.env.DEFAULT_OPERATOR_EMAIL || 'operador@sentinela.local'} / ${process.env.DEFAULT_OPERATOR_PASSWORD || 'operador123'}`);
      // console.log('=============================================================\n');
    });
  } catch (error) {
    console.error('\n[Sentinela Erro Fatal] Não foi possível iniciar o servidor:', error.message);
    console.error('Certifique-se de que o serviço do MySQL está rodando e as credenciais no .env estão corretas.');
    process.exit(1);
  }
}

startServer();
