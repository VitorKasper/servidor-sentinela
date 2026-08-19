/**
 * Middleware para restringir rotas exclusivamente a Administradores (ADMIN)
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'ADMIN') {
    return next();
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(403).json({ error: 'Acesso negado: Requer privilégios de Administrador.' });
  }

  req.flash('error', 'Acesso negado: Você não possui permissão de Administrador para esta ação.');
  return res.redirect('/dashboard');
}

/**
 * Middleware para operadores e administradores (visualização de projetos e terminal)
 */
function requireOperatorOrAdmin(req, res, next) {
  if (req.session && req.session.user && ['ADMIN', 'OPERATOR'].includes(req.session.user.role)) {
    return next();
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  req.flash('error', 'Acesso negado.');
  return res.redirect('/auth/login');
}

module.exports = {
  requireAdmin,
  requireOperatorOrAdmin
};
