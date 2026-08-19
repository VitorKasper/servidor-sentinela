const { User } = require('../models');

/**
 * Lista todos os usuários do sistema
 */
exports.index = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'active', 'createdAt', 'updatedAt'],
      order: [['role', 'ASC'], ['name', 'ASC']]
    });

    res.render('users/index', {
      title: 'Gerenciamento de Usuários - Servidor Sentinela',
      users
    });
  } catch (error) {
    console.error('[Users] Erro ao listar usuários:', error);
    req.flash('error', 'Erro ao carregar lista de usuários.');
    res.redirect('/dashboard');
  }
};

/**
 * Cadastra um novo usuário (Admin ou Operador)
 */
exports.create = async (req, res) => {
  const { name, email, password, role } = req.body;

  try {
    if (!name || !email || !password || !role) {
      req.flash('error', 'Todos os campos são obrigatórios para cadastro.');
      return res.redirect('/users');
    }

    const existingUser = await User.findOne({ where: { email: email.trim().toLowerCase() } });
    if (existingUser) {
      req.flash('error', 'Já existe um usuário cadastrado com este e-mail.');
      return res.redirect('/users');
    }

    await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: password,
      role: role === 'ADMIN' ? 'ADMIN' : 'OPERATOR',
      active: true
    });

    req.flash('success', `Usuário '${name}' cadastrado com sucesso.`);
    return res.redirect('/users');
  } catch (error) {
    console.error('[Users] Erro ao cadastrar usuário:', error);
    req.flash('error', `Erro ao cadastrar usuário: ${error.message}`);
    return res.redirect('/users');
  }
};

/**
 * Atualiza um usuário existente
 */
exports.update = async (req, res) => {
  const { name, role, active, password } = req.body;

  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      req.flash('error', 'Usuário não encontrado.');
      return res.redirect('/users');
    }

    // Impede que o admin logado remova seu próprio papel de admin ou se desative
    if (user.id === req.session.user.id && (role !== 'ADMIN' || active === 'false')) {
      req.flash('error', 'Você não pode alterar seu próprio papel de administrador ou se desativar.');
      return res.redirect('/users');
    }

    if (name) user.name = name.trim();
    if (role) user.role = role === 'ADMIN' ? 'ADMIN' : 'OPERATOR';
    if (active !== undefined) user.active = active === 'true' || active === true || active === 'on';
    if (password && password.trim()) {
      user.password = password.trim();
    }

    await user.save();
    req.flash('success', `Usuário '${user.name}' atualizado com sucesso.`);
    return res.redirect('/users');
  } catch (error) {
    console.error('[Users] Erro ao atualizar usuário:', error);
    req.flash('error', `Erro ao atualizar usuário: ${error.message}`);
    return res.redirect('/users');
  }
};

/**
 * Remove um usuário do sistema
 */
exports.delete = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      req.flash('error', 'Usuário não encontrado.');
      return res.redirect('/users');
    }

    if (user.id === req.session.user.id) {
      req.flash('error', 'Você não pode excluir sua própria conta logada.');
      return res.redirect('/users');
    }

    await user.destroy();
    req.flash('success', `Usuário '${user.name}' excluído com sucesso.`);
    return res.redirect('/users');
  } catch (error) {
    console.error('[Users] Erro ao excluir usuário:', error);
    req.flash('error', `Erro ao excluir usuário: ${error.message}`);
    return res.redirect('/users');
  }
};
