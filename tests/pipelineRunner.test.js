const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');

/**
 * O pipelineRunner depende de models (Sequelize) e do processManager (spawn).
 * Estes testes exercitam a lógica de decisão do executor com esses módulos
 * substituídos por dublês, sem banco nem processos reais.
 */
function carregarRunnerComDubles(dubles) {
  const resolvidos = {};
  for (const [nome, valor] of Object.entries(dubles)) {
    resolvidos[require.resolve(nome, { paths: [path.join(__dirname, '..', 'services')] })] = valor;
  }

  const originais = {};
  for (const caminho of Object.keys(resolvidos)) {
    originais[caminho] = require.cache[caminho];
    require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: resolvidos[caminho] };
  }

  const caminhoRunner = require.resolve('../services/pipelineRunner');
  delete require.cache[caminhoRunner];
  const runner = require('../services/pipelineRunner');

  const restaurar = () => {
    for (const [caminho, original] of Object.entries(originais)) {
      if (original) require.cache[caminho] = original;
      else delete require.cache[caminho];
    }
    delete require.cache[caminhoRunner];
  };

  return { runner, restaurar };
}

function projetoFalso(dados) {
  return {
    ...dados,
    save: async function () { this.salvo = true; },
    toJSON: function () { return { ...dados }; }
  };
}

test('reconcile atualiza o projeto existente com nome, porta, start e steps da definição', async () => {
  const proj = projetoFalso({ id: 1, pipelineKey: 'api', name: 'Velho', port: 1, startCommand: 'velho', status: 'STOPPED', slug: 'ws-api' });

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': {
      Workspace: {},
      DeploymentLog: { create: async () => {} },
      Project: {
        findAll: async () => [proj],
        findOne: async () => null,
        create: async (d) => projetoFalso({ id: 99, ...d })
      }
    },
    './processManager': { stopProject: async () => {}, appendLog: () => {} }
  });

  try {
    const def = {
      version: 1,
      setup: [],
      terminals: [{ key: 'api', name: 'API', port: 3000, type: 'NODEJS', cwd: null, steps: [{ name: 'b', run: 'npm run build', cwd: null }], start: 'npm run api', env: null }]
    };

    await runner.reconcile({ id: 10, name: 'WS' }, def, null, () => {});

    assert.strictEqual(proj.name, 'API');
    assert.strictEqual(proj.port, 3000);
    assert.strictEqual(proj.startCommand, 'npm run api');
    assert.deepStrictEqual(JSON.parse(proj.pipelineSteps), [{ name: 'b', run: 'npm run build', cwd: null }]);
  } finally {
    restaurar();
  }
});

test('reconcile marca como órfão, sem excluir, o projeto que sumiu da definição', async () => {
  const sobrevivente = projetoFalso({ id: 1, pipelineKey: 'api', slug: 'ws-api', status: 'RUNNING' });
  const removido = projetoFalso({ id: 2, pipelineKey: 'antigo', slug: 'ws-antigo', status: 'RUNNING' });
  let paradoId = null;
  let destruiuAlgo = false;

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': {
      Workspace: {},
      DeploymentLog: { create: async () => {} },
      Project: {
        findAll: async () => [sobrevivente, removido],
        findOne: async () => null,
        create: async (d) => projetoFalso({ id: 99, ...d }),
        destroy: async () => { destruiuAlgo = true; }
      }
    },
    './processManager': {
      stopProject: async (id) => { paradoId = id; },
      appendLog: () => {}
    }
  });

  try {
    const def = {
      version: 1,
      setup: [],
      terminals: [{ key: 'api', name: 'API', port: null, type: 'NODEJS', cwd: null, steps: [], start: 'node a.js', env: null }]
    };

    await runner.reconcile({ id: 10, name: 'WS' }, def, null, () => {});

    assert.strictEqual(removido.status, 'ORPHANED');
    assert.strictEqual(paradoId, 2, 'o processo do terminal órfão precisa ser parado');
    assert.strictEqual(destruiuAlgo, false, 'nenhum projeto pode ser excluído pela reconciliação');
  } finally {
    restaurar();
  }
});

test('reconcile devolve os terminais na ordem declarada na definição', async () => {
  const a = projetoFalso({ id: 1, pipelineKey: 'a', slug: 'ws-a', status: 'STOPPED' });
  const b = projetoFalso({ id: 2, pipelineKey: 'b', slug: 'ws-b', status: 'STOPPED' });

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': {
      Workspace: {},
      DeploymentLog: { create: async () => {} },
      Project: {
        findAll: async () => [a, b],
        findOne: async () => null,
        create: async (d) => projetoFalso({ id: 99, ...d })
      }
    },
    './processManager': { stopProject: async () => {}, appendLog: () => {} }
  });

  try {
    const def = {
      version: 1,
      setup: [],
      // 'b' antes de 'a' — a ordem de subida precisa seguir a definição, não o banco
      terminals: [
        { key: 'b', name: 'B', port: null, type: 'NODEJS', cwd: null, steps: [], start: 'node b.js', env: null },
        { key: 'a', name: 'A', port: null, type: 'NODEJS', cwd: null, steps: [], start: 'node a.js', env: null }
      ]
    };

    const ordem = await runner.reconcile({ id: 10, name: 'WS' }, def, null, () => {});
    assert.deepStrictEqual(ordem.map(p => p.pipelineKey), ['b', 'a']);
  } finally {
    restaurar();
  }
});

test('loadDefinition prefere o sentinela.yml do repositório sobre a definição da UI', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinela-'));
  fs.writeFileSync(path.join(dir, 'sentinela.yml'), 'version: 1\nterminals:\n  - key: doRepo\n    start: node repo.js\n');

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': { Workspace: {}, Project: { findAll: async () => [] }, DeploymentLog: {} },
    './processManager': { appendLog: () => {} }
  });

  try {
    const workspace = {
      id: 1,
      pipelineDefinition: 'version: 1\nterminals:\n  - key: daUi\n    start: node ui.js\n',
      save: async () => {}
    };
    const { def, source } = await runner.loadDefinition(workspace, dir, () => {});

    assert.strictEqual(source, 'REPO');
    assert.strictEqual(def.terminals[0].key, 'doRepo');
  } finally {
    restaurar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadDefinition cai para a definição da UI quando o repositório não traz o arquivo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinela-'));

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': { Workspace: {}, Project: { findAll: async () => [] }, DeploymentLog: {} },
    './processManager': { appendLog: () => {} }
  });

  try {
    const workspace = {
      id: 1,
      pipelineDefinition: 'version: 1\nterminals:\n  - key: daUi\n    start: node ui.js\n',
      save: async () => {}
    };
    const { def, source } = await runner.loadDefinition(workspace, dir, () => {});

    assert.strictEqual(source, 'UI');
    assert.strictEqual(def.terminals[0].key, 'daUi');
  } finally {
    restaurar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadDefinition sintetiza e persiste um pipeline quando não há nenhuma definição', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinela-'));

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': { Workspace: {}, Project: { findAll: async () => [] }, DeploymentLog: {} },
    './processManager': { appendLog: () => {} }
  });

  try {
    let salvou = false;
    const workspace = {
      id: 1,
      installCommand: 'npm ci',
      buildCommand: null,
      pipelineDefinition: null,
      projects: [
        { toJSON: () => ({ slug: 'ws-api', name: 'API', port: 3000, startCommand: 'npm run api', projectType: 'NODEJS' }) }
      ],
      save: async function () { salvou = true; }
    };

    const { def, source } = await runner.loadDefinition(workspace, dir, () => {});

    assert.strictEqual(source, 'UI');
    assert.deepStrictEqual(def.setup.map(s => s.run), ['npm ci']);
    assert.strictEqual(def.terminals[0].key, 'ws-api');
    assert.ok(salvou, 'o pipeline sintetizado precisa ser persistido para virar editável na UI');
    assert.ok(workspace.pipelineDefinition.includes('ws-api'));
  } finally {
    restaurar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resetTerminal recusa quando há um deploy do workspace em andamento', async () => {
  let liberar;
  const emAndamento = new Promise(r => { liberar = r; });

  const projeto = projetoFalso({
    id: 5,
    workspaceId: 10,
    slug: 'ws-api',
    pipelineKey: 'api',
    status: 'RUNNING',
    workspace: { id: 10, name: 'WS', slug: 'ws' }
  });

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': {
      Workspace: { findByPk: async () => ({ id: 10, name: 'WS', slug: 'ws', projects: [], save: async () => {} }) },
      DeploymentLog: { create: async () => {} },
      Project: { findByPk: async () => projeto, findAll: async () => [] }
    },
    './processManager': {
      appendLog: () => {},
      stopProject: async () => {},
      startProject: async () => ({ success: true }),
      parseEnvVars: () => ({}),
      ensurePythonVenv: async () => {},
      formatCommandWithSslBypass: (c) => c,
      runCommand: async () => 0
    },
    './gitService': {
      cloneOrPull: async () => { await emAndamento; return { path: '/tmp/x', commitHash: 'abc' }; },
      getProjectPath: () => '/tmp/x',
      getWorkspacePath: () => '/tmp/x'
    }
  });

  try {
    const deploy = runner.runPipeline(10, null).catch(() => {});
    // dá uma volta no event loop para o lock ser registrado
    await new Promise(r => setImmediate(r));

    await assert.rejects(
      () => runner.resetTerminal(5, null),
      /deploy do workspace em andamento/i
    );

    liberar();
    await deploy;
  } finally {
    restaurar();
  }
});

test('resetTerminal recusa um terminal órfão', async () => {
  const projeto = projetoFalso({
    id: 5,
    workspaceId: 10,
    slug: 'ws-api',
    pipelineKey: 'api',
    status: 'ORPHANED',
    workspace: { id: 10, name: 'WS', slug: 'ws' }
  });

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': {
      Workspace: {},
      DeploymentLog: { create: async () => {} },
      Project: { findByPk: async () => projeto }
    },
    './processManager': { appendLog: () => {} }
  });

  try {
    await assert.rejects(() => runner.resetTerminal(5, null), /não existe mais na definição/i);
  } finally {
    restaurar();
  }
});

test('resetTerminal roda apenas as etapas do terminal e não toca no git', async () => {
  const projeto = projetoFalso({
    id: 5,
    workspaceId: 10,
    slug: 'ws-api',
    pipelineKey: 'api',
    status: 'RUNNING',
    envVars: null,
    port: 3000,
    ignoreSsl: false,
    pipelineSteps: JSON.stringify([{ name: 'build', run: 'npm run build:api', cwd: null }]),
    workspace: { id: 10, name: 'WS', slug: 'ws' }
  });

  const comandos = [];
  let gitChamado = false;
  let iniciou = false;

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': {
      Workspace: {},
      DeploymentLog: { create: async () => {} },
      Project: { findByPk: async () => projeto }
    },
    './processManager': {
      appendLog: () => {},
      stopProject: async () => {},
      startProject: async () => { iniciou = true; return { success: true, pid: 123 }; },
      parseEnvVars: () => ({}),
      formatCommandWithSslBypass: (c) => c,
      runCommand: async (cmd) => { comandos.push(cmd); return 0; }
    },
    './gitService': {
      cloneOrPull: async () => { gitChamado = true; return {}; },
      getProjectPath: () => __dirname,
      getWorkspacePath: () => __dirname
    }
  });

  try {
    await runner.resetTerminal(5, null);

    assert.deepStrictEqual(comandos, ['npm run build:api']);
    assert.strictEqual(gitChamado, false, 'o reset de um terminal não pode refazer o clone/pull compartilhado');
    assert.ok(iniciou);
  } finally {
    restaurar();
  }
});

test('resetTerminal recusa projeto que não pertence a um workspace', async () => {
  const projeto = projetoFalso({ id: 5, workspaceId: null, slug: 'avulso', status: 'RUNNING' });

  const { runner, restaurar } = carregarRunnerComDubles({
    '../models': { Workspace: {}, DeploymentLog: {}, Project: { findByPk: async () => projeto } },
    './processManager': { appendLog: () => {} }
  });

  try {
    await assert.rejects(() => runner.resetTerminal(5, null), /não pertence a um workspace/i);
  } finally {
    restaurar();
  }
});
