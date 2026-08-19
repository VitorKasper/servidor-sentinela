/**
 * Middleware para garantir que o usuário está autenticado
 */
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    res.locals.currentUser = req.session.user;
    res.locals.currentPath = req.path;
    return next();
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(401).json({ error: 'Não autorizado. Por favor, realize o login.' });
  }

  req.flash('error', 'Você precisa estar autenticado para acessar esta página.');
  return res.redirect('/auth/login');
}

/**
 * Middleware para redirecionar usuários já logados para fora da tela de login
 */
function isGuest(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  return next();
}

module.exports = {
  isAuthenticated,
  isGuest
};
