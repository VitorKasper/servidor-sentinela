const { User } = require('../models');

/**
 * Exibe a página de login
 */
exports.showLogin = (req, res) => {
  res.render('auth/login', {
    title: 'Login - Servidor Sentinela',
    layout: 'layouts/auth'
  });
};

/**
 * Processa a autenticação do usuário
 */
exports.postLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      req.flash('error', 'Por favor, preencha todos os campos.');
      return res.redirect('/auth/login');
    }

    const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });

    if (!user || !user.active) {
      req.flash('error', 'Credenciais inválidas ou usuário inativo.');
      return res.redirect('/auth/login');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      req.flash('error', 'Credenciais inválidas.');
      return res.redirect('/auth/login');
    }

    // Salva na sessão
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    req.flash('success', `Bem-vindo de volta, ${user.name}!`);
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('[Auth] Erro no login:', error);
    req.flash('error', 'Ocorreu um erro interno ao processar seu login.');
    return res.redirect('/auth/login');
  }
};

/**
 * Encerra a sessão do usuário
 */
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('[Auth] Erro ao encerrar sessão:', err);
    res.redirect('/auth/login');
  });
};
