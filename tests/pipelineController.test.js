const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const pipelineService = require('../services/pipelineService');

/**
 * O controller depende de services que falam com o banco. Aqui só interessa a
 * conversão do payload do editor visual em uma definição válida, então os
 * services são substituídos por dublês.
 */
function carregarController() {
  const caminhos = {
    '../services/workspaceService': {},
    '../services/pipelineRunner': {}
  };

  const originais = {};
  for (const [nome, valor] of Object.entries(caminhos)) {
    const resolvido = require.resolve(nome, { paths: [path.join(__dirname, '..', 'controllers')] });
    originais[resolvido] = require.cache[resolvido];
    require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports: valor };
  }

  const caminhoCtrl = require.resolve('../controllers/pipelineController');
  delete require.cache[caminhoCtrl];
  const ctrl = require('../controllers/pipelineController');

  return {
    ctrl,
    restaurar() {
      for (const [caminho, original] of Object.entries(originais)) {
        if (original) require.cache[caminho] = original;
        else delete require.cache[caminho];
      }
      delete require.cache[caminhoCtrl];
    }
  };
}

// Este é o formato exato que public/js/pipeline-editor.js envia ao servidor.
const PAYLOAD_DO_EDITOR = {
  setup: [
    { name: 'deps', run: 'npm install', cwd: null },
    { name: '', run: '', cwd: null }             // linha em branco que o usuário adicionou e não preencheu
  ],
  terminals: [
    {
      key: 'api',
      name: 'API',
      port: 3000,
      type: 'nodejs',
      cwd: null,
      steps: [
        { name: 'build', run: 'npm run build:api', cwd: null },
        { name: '', run: '', cwd: null }
      ],
      start: 'npm run start:api',
      env: null
    },
    { key: 'worker', name: 'Worker', port: null, type: 'NODEJS', cwd: null, steps: [], start: 'npm run worker', env: null }
  ]
};

test('o payload do editor visual vira uma definição válida do pipeline', () => {
  const { ctrl, restaurar } = carregarController();
  try {
    const def = ctrl.definitionFromForm(PAYLOAD_DO_EDITOR);
    const yaml = pipelineService.serializeDefinition(def);
    const relido = pipelineService.parseDefinition(yaml);

    assert.deepStrictEqual(relido.setup.map(s => s.run), ['npm install'], 'linhas em branco não podem virar etapas');
    assert.deepStrictEqual(relido.terminals.map(t => t.key), ['api', 'worker']);
    assert.strictEqual(relido.terminals[0].port, 3000);
    assert.strictEqual(relido.terminals[0].type, 'NODEJS', 'a stack precisa ser normalizada em maiúsculas');
    assert.deepStrictEqual(relido.terminals[0].steps.map(s => s.run), ['npm run build:api']);
    assert.strictEqual(relido.terminals[1].port, null);
  } finally {
    restaurar();
  }
});

test('um terminal sem comando de start é rejeitado antes de chegar ao banco', () => {
  const { ctrl, restaurar } = carregarController();
  try {
    const def = ctrl.definitionFromForm({
      setup: [],
      terminals: [{ key: 'api', name: 'API', start: '' }]
    });
    assert.throws(() => pipelineService.parseDefinition(pipelineService.serializeDefinition(def)), /start/);
  } finally {
    restaurar();
  }
});
