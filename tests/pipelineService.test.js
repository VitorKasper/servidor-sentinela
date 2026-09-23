const test = require('node:test');
const assert = require('node:assert');
const pipelineService = require('../services/pipelineService');

const YAML_BASICO = `
version: 1
setup:
  - name: deps
    run: npm install
terminals:
  - key: api
    name: API
    port: 3000
    start: npm run start:api
`;

test('parseDefinition lê setup e terminals de um YAML válido', () => {
  const def = pipelineService.parseDefinition(YAML_BASICO);
  assert.strictEqual(def.version, 1);
  assert.strictEqual(def.setup.length, 1);
  assert.deepStrictEqual(def.setup[0], { name: 'deps', run: 'npm install', cwd: null });
  assert.strictEqual(def.terminals.length, 1);
  assert.strictEqual(def.terminals[0].key, 'api');
  assert.strictEqual(def.terminals[0].port, 3000);
  assert.strictEqual(def.terminals[0].start, 'npm run start:api');
  assert.deepStrictEqual(def.terminals[0].steps, []);
});

test('parseDefinition aceita definição sem setup', () => {
  const def = pipelineService.parseDefinition(`
version: 1
terminals:
  - key: worker
    start: npm run worker
`);
  assert.deepStrictEqual(def.setup, []);
  assert.strictEqual(def.terminals[0].name, 'worker');
});

test('parseDefinition preserva steps próprias de cada terminal', () => {
  const def = pipelineService.parseDefinition(`
version: 1
terminals:
  - key: api
    start: node api.js
    steps:
      - run: npm run build:api
      - name: migra
        run: npm run migrate
        cwd: backend
`);
  const steps = def.terminals[0].steps;
  assert.strictEqual(steps.length, 2);
  assert.strictEqual(steps[0].run, 'npm run build:api');
  assert.strictEqual(steps[1].cwd, 'backend');
});

test('parseDefinition rejeita YAML malformado', () => {
  assert.throws(() => pipelineService.parseDefinition('terminals: [a: 1'), /YAML inválido/);
});

test('parseDefinition rejeita definição sem terminais', () => {
  assert.throws(() => pipelineService.parseDefinition('version: 1\nsetup: []'), /pelo menos um terminal/);
});

test('parseDefinition rejeita terminal sem key', () => {
  assert.throws(
    () => pipelineService.parseDefinition('version: 1\nterminals:\n  - start: node x.js'),
    /key/
  );
});

test('parseDefinition rejeita terminal sem start', () => {
  assert.throws(
    () => pipelineService.parseDefinition('version: 1\nterminals:\n  - key: api'),
    /start/
  );
});

test('parseDefinition rejeita keys duplicadas', () => {
  assert.throws(
    () => pipelineService.parseDefinition(`
version: 1
terminals:
  - key: api
    start: a
  - key: api
    start: b
`),
    /duplicad/i
  );
});

test('parseDefinition rejeita etapa de setup sem run', () => {
  assert.throws(
    () => pipelineService.parseDefinition('version: 1\nsetup:\n  - name: x\nterminals:\n  - key: a\n    start: b'),
    /run/
  );
});

test('parseDefinition rejeita versão desconhecida', () => {
  assert.throws(
    () => pipelineService.parseDefinition('version: 9\nterminals:\n  - key: a\n    start: b'),
    /versão/i
  );
});

test('parseDefinition rejeita cwd que escapa da raiz do workspace', () => {
  assert.throws(
    () => pipelineService.parseDefinition(`
version: 1
terminals:
  - key: api
    start: node x.js
    steps:
      - run: rm -rf /
        cwd: ../../fora
`),
    /cwd/
  );
});

test('serializeDefinition gera YAML que volta igual no parse', () => {
  const original = pipelineService.parseDefinition(YAML_BASICO);
  const roundtrip = pipelineService.parseDefinition(pipelineService.serializeDefinition(original));
  assert.deepStrictEqual(roundtrip, original);
});

test('synthesizeFromLegacy monta pipeline a partir do workspace e projetos atuais', () => {
  const def = pipelineService.synthesizeFromLegacy(
    { installCommand: 'npm install', buildCommand: 'npm run build' },
    [
      { slug: 'meu-ws-api', name: 'API', port: 3000, startCommand: 'npm run api', projectType: 'NODEJS' },
      { slug: 'meu-ws-worker', name: 'Worker', port: null, startCommand: 'npm run worker', projectType: 'NODEJS' }
    ]
  );

  assert.deepStrictEqual(def.setup.map(s => s.run), ['npm install', 'npm run build']);
  assert.deepStrictEqual(def.terminals.map(t => t.key), ['meu-ws-api', 'meu-ws-worker']);
  assert.strictEqual(def.terminals[0].start, 'npm run api');
  assert.strictEqual(def.terminals[1].port, null);
  // O resultado sintetizado precisa ser uma definição válida
  assert.doesNotThrow(() => pipelineService.parseDefinition(pipelineService.serializeDefinition(def)));
});

test('synthesizeFromLegacy ignora comandos vazios no setup', () => {
  const def = pipelineService.synthesizeFromLegacy(
    { installCommand: '   ', buildCommand: null },
    [{ slug: 'a', name: 'A', startCommand: 'node a.js' }]
  );
  assert.deepStrictEqual(def.setup, []);
});

test('synthesizeFromLegacy falha quando não há projetos para virar terminal', () => {
  assert.throws(() => pipelineService.synthesizeFromLegacy({}, []), /nenhum projeto/i);
});

test('planReconciliation casa terminal com projeto existente pela pipelineKey', () => {
  const def = pipelineService.parseDefinition(YAML_BASICO);
  const plano = pipelineService.planReconciliation(def, [
    { id: 7, pipelineKey: 'api', name: 'Nome Antigo' }
  ]);

  assert.strictEqual(plano.create.length, 0);
  assert.strictEqual(plano.orphan.length, 0);
  assert.strictEqual(plano.update.length, 1);
  assert.strictEqual(plano.update[0].projectId, 7);
  assert.strictEqual(plano.update[0].terminal.name, 'API');
});

test('planReconciliation cria terminal que ainda não tem projeto', () => {
  const def = pipelineService.parseDefinition(YAML_BASICO);
  const plano = pipelineService.planReconciliation(def, []);
  assert.strictEqual(plano.create.length, 1);
  assert.strictEqual(plano.create[0].key, 'api');
});

test('planReconciliation marca como órfão o projeto cuja key sumiu da definição', () => {
  const def = pipelineService.parseDefinition(YAML_BASICO);
  const plano = pipelineService.planReconciliation(def, [
    { id: 7, pipelineKey: 'api' },
    { id: 8, pipelineKey: 'removido' }
  ]);
  assert.deepStrictEqual(plano.orphan.map(p => p.id), [8]);
});

test('planReconciliation adota projeto legado sem pipelineKey pelo slug', () => {
  const def = pipelineService.parseDefinition(`
version: 1
terminals:
  - key: meu-ws-api
    start: node api.js
`);
  const plano = pipelineService.planReconciliation(def, [
    { id: 7, pipelineKey: null, slug: 'meu-ws-api' }
  ]);

  assert.strictEqual(plano.create.length, 0);
  assert.strictEqual(plano.orphan.length, 0);
  assert.strictEqual(plano.update[0].projectId, 7);
});
