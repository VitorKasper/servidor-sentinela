const path = require('path');
const fs = require('fs');
const YAML = require('yaml');

const PIPELINE_FILENAMES = ['sentinela.yml', 'sentinela.yaml'];
const SUPPORTED_VERSION = 1;

/**
 * Normaliza e valida uma etapa (usada tanto no 'setup' quanto nas 'steps' de um terminal)
 */
function normalizeStep(raw, contexto, indice) {
  const onde = `${contexto} (etapa #${indice + 1})`;

  if (typeof raw === 'string') {
    raw = { run: raw };
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${onde}: etapa deve ser um objeto com 'run' ou uma string de comando.`);
  }

  const run = typeof raw.run === 'string' ? raw.run.trim() : '';
  if (!run) {
    throw new Error(`${onde}: campo 'run' é obrigatório e não pode ser vazio.`);
  }

  let cwd = null;
  if (raw.cwd !== undefined && raw.cwd !== null && String(raw.cwd).trim()) {
    cwd = String(raw.cwd).trim().replace(/\\/g, '/');
    const normalizado = path.posix.normalize(cwd);
    if (path.isAbsolute(cwd) || normalizado.startsWith('..')) {
      throw new Error(`${onde}: 'cwd' deve ser um caminho relativo dentro do workspace (recebido: '${raw.cwd}').`);
    }
    cwd = normalizado;
  }

  const name = (raw.name && String(raw.name).trim()) ? String(raw.name).trim() : run;

  return { name, run, cwd };
}

/**
 * Normaliza e valida um terminal da definição
 */
function normalizeTerminal(raw, indice) {
  const onde = `terminals[${indice}]`;

  if (!raw || typeof raw !== 'object') {
    throw new Error(`${onde}: cada terminal deve ser um objeto.`);
  }

  const key = (raw.key !== undefined && raw.key !== null) ? String(raw.key).trim() : '';
  if (!key) {
    throw new Error(`${onde}: campo 'key' é obrigatório (identificador estável do terminal).`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(key)) {
    throw new Error(`${onde}: 'key' deve conter apenas letras, números, '-' e '_' (recebido: '${key}').`);
  }

  const start = (typeof raw.start === 'string') ? raw.start.trim() : '';
  if (!start) {
    throw new Error(`${onde} ('${key}'): campo 'start' é obrigatório — é o comando que mantém o terminal em execução.`);
  }

  let port = null;
  if (raw.port !== undefined && raw.port !== null && String(raw.port).trim() !== '') {
    port = parseInt(String(raw.port).trim(), 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`${onde} ('${key}'): 'port' deve ser um número entre 1 e 65535.`);
    }
  }

  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  const steps = stepsRaw.map((s, i) => normalizeStep(s, `${onde} ('${key}').steps`, i));

  let cwd = null;
  if (raw.cwd !== undefined && raw.cwd !== null && String(raw.cwd).trim()) {
    cwd = normalizeStep({ run: 'noop', cwd: raw.cwd }, `${onde} ('${key}')`, 0).cwd;
  }

  return {
    key,
    name: (raw.name && String(raw.name).trim()) ? String(raw.name).trim() : key,
    port,
    type: (raw.type && String(raw.type).trim()) ? String(raw.type).trim().toUpperCase() : 'NODEJS',
    cwd,
    steps,
    start,
    env: (typeof raw.env === 'string' && raw.env.trim()) ? raw.env.trim() : null
  };
}

/**
 * Converte o YAML do pipeline em uma definição normalizada e validada.
 * Lança Error com mensagem legível em qualquer inconsistência — uma definição
 * inválida deve abortar o deploy inteiro, nunca rodar pela metade.
 */
function parseDefinition(yamlText) {
  if (!yamlText || !String(yamlText).trim()) {
    throw new Error('Pipeline vazio: nenhuma definição foi informada.');
  }

  let doc;
  try {
    doc = YAML.parse(String(yamlText));
  } catch (err) {
    throw new Error(`YAML inválido: ${err.message}`);
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error("YAML inválido: a raiz do pipeline deve ser um objeto com as chaves 'version', 'setup' e 'terminals'.");
  }

  const version = (doc.version === undefined || doc.version === null) ? SUPPORTED_VERSION : parseInt(doc.version, 10);
  if (version !== SUPPORTED_VERSION) {
    throw new Error(`Versão de pipeline não suportada: '${doc.version}'. Esta instalação entende apenas 'version: ${SUPPORTED_VERSION}'.`);
  }

  if (doc.setup !== undefined && doc.setup !== null && !Array.isArray(doc.setup)) {
    throw new Error("'setup' deve ser uma lista de etapas.");
  }
  const setup = (doc.setup || []).map((s, i) => normalizeStep(s, 'setup', i));

  if (doc.terminals !== undefined && doc.terminals !== null && !Array.isArray(doc.terminals)) {
    throw new Error("'terminals' deve ser uma lista de terminais.");
  }
  const terminaisRaw = doc.terminals || [];
  if (terminaisRaw.length === 0) {
    throw new Error("O pipeline precisa declarar pelo menos um terminal em 'terminals'.");
  }

  const terminals = terminaisRaw.map((t, i) => normalizeTerminal(t, i));

  const vistas = new Set();
  for (const t of terminals) {
    if (vistas.has(t.key)) {
      throw new Error(`Chave de terminal duplicada: '${t.key}'. Cada 'key' precisa ser única dentro do pipeline.`);
    }
    vistas.add(t.key);
  }

  const portas = new Map();
  for (const t of terminals) {
    if (t.port === null) continue;
    if (portas.has(t.port)) {
      throw new Error(`Porta ${t.port} declarada em dois terminais ('${portas.get(t.port)}' e '${t.key}').`);
    }
    portas.set(t.port, t.key);
  }

  return { version, setup, terminals };
}

/**
 * Converte uma definição normalizada de volta em YAML (usado pelo editor da UI)
 */
function serializeDefinition(def) {
  const doc = {
    version: def.version || SUPPORTED_VERSION,
    setup: (def.setup || []).map(s => {
      const out = { name: s.name, run: s.run };
      if (s.cwd) out.cwd = s.cwd;
      return out;
    }),
    terminals: (def.terminals || []).map(t => {
      const out = { key: t.key, name: t.name };
      if (t.port !== null && t.port !== undefined) out.port = t.port;
      if (t.type) out.type = t.type;
      if (t.cwd) out.cwd = t.cwd;
      if (t.steps && t.steps.length > 0) {
        out.steps = t.steps.map(s => {
          const step = { name: s.name, run: s.run };
          if (s.cwd) step.cwd = s.cwd;
          return step;
        });
      }
      out.start = t.start;
      if (t.env) out.env = t.env;
      return out;
    })
  };

  return YAML.stringify(doc, { lineWidth: 0 });
}

/**
 * Localiza o arquivo de pipeline versionado na raiz do repositório clonado
 */
function findRepoPipelineFile(workspaceDir) {
  for (const nome of PIPELINE_FILENAMES) {
    const candidato = path.join(workspaceDir, nome);
    if (fs.existsSync(candidato)) return candidato;
  }
  return null;
}

/**
 * Sintetiza um pipeline a partir da configuração legada (workspace + projetos já cadastrados).
 * Serve para migrar workspaces criados antes do pipeline sem quebrar nada.
 */
function synthesizeFromLegacy(workspace, projects) {
  const lista = projects || [];
  if (lista.length === 0) {
    throw new Error('Não é possível sintetizar um pipeline: nenhum projeto cadastrado neste workspace.');
  }

  const setup = [];
  if (workspace && workspace.installCommand && String(workspace.installCommand).trim()) {
    setup.push({ name: 'install', run: String(workspace.installCommand).trim(), cwd: null });
  }
  if (workspace && workspace.buildCommand && String(workspace.buildCommand).trim()) {
    setup.push({ name: 'build', run: String(workspace.buildCommand).trim(), cwd: null });
  }

  const terminals = lista.map(proj => ({
    key: proj.slug,
    name: proj.name || proj.slug,
    port: (proj.port === undefined || proj.port === null || proj.port === '') ? null : parseInt(proj.port, 10),
    type: (proj.projectType || 'NODEJS').split(',')[0].trim().toUpperCase(),
    cwd: null,
    steps: [],
    start: String(proj.startCommand || 'npm start').trim(),
    env: (proj.envVars && String(proj.envVars).trim()) ? String(proj.envVars).trim() : null
  }));

  return { version: SUPPORTED_VERSION, setup, terminals };
}

/**
 * Calcula o plano de reconciliação entre os terminais da definição e os projetos existentes.
 * Não toca no banco — devolve o que criar, o que atualizar e o que marcar como órfão.
 */
function planReconciliation(def, projects) {
  const existentes = projects || [];

  const porKey = new Map();
  for (const proj of existentes) {
    if (proj.pipelineKey) porKey.set(proj.pipelineKey, proj);
  }
  // Projetos legados (sem pipelineKey) são adotados pelo slug, que é como as
  // chaves sintetizadas são geradas em synthesizeFromLegacy.
  const porSlug = new Map();
  for (const proj of existentes) {
    if (!proj.pipelineKey && proj.slug) porSlug.set(proj.slug, proj);
  }

  const create = [];
  const update = [];
  const casados = new Set();

  for (const terminal of def.terminals) {
    const alvo = porKey.get(terminal.key) || porSlug.get(terminal.key);
    if (alvo && !casados.has(alvo.id)) {
      casados.add(alvo.id);
      update.push({ projectId: alvo.id, project: alvo, terminal });
    } else {
      create.push(terminal);
    }
  }

  const orphan = existentes.filter(p => !casados.has(p.id));

  return { create, update, orphan };
}

module.exports = {
  PIPELINE_FILENAMES,
  SUPPORTED_VERSION,
  parseDefinition,
  serializeDefinition,
  findRepoPipelineFile,
  synthesizeFromLegacy,
  planReconciliation
};
