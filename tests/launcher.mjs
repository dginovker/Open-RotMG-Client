import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../launcher.js', import.meta.url), 'utf8');
const webglCanvas = {getContext: type => {
  assert.equal(type, 'webgl2');
  return {isContextLost: () => false};
}};
const shadowRoot = {querySelectorAll: selector => {
  assert.equal(selector, '#container > canvas');
  return [webglCanvas];
}};
for (const protocol of ['http:', 'https:']) for (const prefix of ['/', `/_runtime/${'a'.repeat(64)}/`])
for (const [page, mode, movie] of [['index.html', 'game', 'client.swf'], ['draw.html', 'editor', 'native-texture-editor.swf']]) {
  test(`UNIT ONLY: ${mode} at ${protocol}//127.0.0.1:18923${prefix} loads prefix-relative ${movie} with protected options`, async () => {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.ok(html.includes(`data-mode="${mode}"`));
    assert.ok(html.includes('<script src="launcher.js"></script>'));
    const gameplay = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.equal(html.match(/content="default-src[^"]+"/)[0], gameplay.match(/content="default-src[^"]+"/)[0]);
    let options;
    const errors = [], origin = `${protocol}//127.0.0.1:18923`;
    const location = new URL(`${origin}${prefix}${mode === 'game' ? '' : page}?url=https://evil.example/a.swf`);
    const player = {shadowRoot, addEventListener() {}, ruffle: () => ({load: async value => {options = value;}})};
    const nodes = {'#client': {dataset: {mode}, append() {}, replaceChildren() {}}, '#status': {}};
    await vm.runInNewContext(script, {window: {addEventListener() {}, RufflePlayer: {newest: () => ({createPlayer: () => player})}},
      document: {createElement: () => webglCanvas, querySelector: key => nodes[key]}, URL, location, console: {error: error => errors.push(error)}});
    assert.deepEqual(errors, []);
    assert.equal(nodes['#status'].textContent, '');
    assert.equal(options.preferredRenderer, 'wgpu-webgl');
    assert.equal(options.url, movie);
    assert.equal(new URL(options.url, location.href).href, `${origin}${prefix}${movie}`);
    assert.equal(options.autoplay, 'on');
    assert.equal(options.unmuteOverlay, 'hidden');
    assert.equal(options.logLevel, 'info');
    assert.equal(options.contextMenu, mode === 'game' ? 'off' : 'on');
    assert.equal(options.allowScriptAccess, false);
    assert.equal(options.openUrlMode, mode === 'game' ? 'confirm' : 'deny');
    assert.equal(options.socketProxy.length, 1);
    assert.equal(options.socketProxy[0].host, '127.0.0.1');
    assert.equal(options.socketProxy[0].port, 2050);
    assert.equal(options.socketProxy[0].proxyUrl, `${protocol === 'https:' ? 'wss:' : 'ws:'}//127.0.0.1:18923/game`);
    assert.equal(options.urlRewriteRules.length, 2);
    assert.equal(options.urlRewriteRules[0][1], `${origin}/legacy-api/`);
    assert.equal(options.urlRewriteRules[1][1], `${origin}${prefix}sfx/`);
    const rewrite = url => options.urlRewriteRules.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), url);
    for (const protocol of ['http', 'https']) {
      for (const family of ['char/list', 'account/verify', 'fame/list', 'guild/listMembers', 'picture/save', 'picture/list', 'picture/get', 'picture/delete']) {
        assert.equal(rewrite(`${protocol}://127.0.0.1:8080/${family}`), `${origin}/legacy-api/${family}`);
      }
    }
    for (const scheme of ['http', 'https']) {
      assert.equal(rewrite(`${scheme}://realmofthemadgod.appspot.com/sfx/death.mp3`), `${origin}${prefix}sfx/death.mp3`);
    }
    for (const path of ['/client.swf', '/native-texture-editor.swf', '/vendor/ruffle.js', '/draw.html', '/game']) {
      assert.equal(rewrite('http://127.0.0.1:8080' + path), 'http://127.0.0.1:8080' + path);
    }
    for (const url of ['http://localhost:8080/picture/get', 'http://127.0.0.1:8081/picture/get',
      'https://127.0.0.1.evil.example:8080/picture/get', 'http://127.0.0.1:8080@evil.example/picture/get',
      'http://127.0.0.1:8080/pictures/get', 'http://127.0.0.1:8080/picture',
      'ftp://127.0.0.1:8080/picture/get', 'http://127.0.0.1:8080/?next=/picture/get']) assert.equal(rewrite(url), url);
  });
}
test('missing, arbitrary and URL-like modes fail explicitly without loading any movie', async () => {
  for (const mode of [undefined, '', 'https://evil.example/movie.swf', '../client.swf']) {
    let loads = 0;
    const player = {addEventListener() {}, ruffle: () => ({load: async () => {loads++;}})};
    const nodes = {'#client': {dataset: {mode}, append() {}, replaceChildren() {}}, '#status': {}};
    await vm.runInNewContext(script, {window: {addEventListener() {}, RufflePlayer: {newest: () => ({createPlayer: () => player})}},
      document: {createElement: () => webglCanvas, querySelector: key => nodes[key]}, URL, location: {href: 'https://example.test/'}, console: {error() {}}});
    assert.equal(loads, 0);
    assert.match(nodes['#status'].textContent, /Unknown client mode/);
  }
});

for (const mode of ['game', 'editor']) {
  for (const failure of ['unavailable', 'lost probe', 'Canvas renderer', 'missing shadow root', 'missing canvas', 'ambiguous canvas', 'lost renderer', 'load rejection']) {
    test(`${mode}: ${failure} never appears loaded`, async () => {
      let creates = 0, loads = 0, removals = 0;
      const errors = [];
      const lostCanvas = {getContext: () => ({isContextLost: () => true})};
      // Once a canvas has a 2D context the browser returns null for getContext('webgl2').
      const canvas2D = {getContext: () => null};
      const canvases = {'Canvas renderer': [canvas2D], 'missing canvas': [],
        'ambiguous canvas': [webglCanvas, webglCanvas], 'lost renderer': [lostCanvas]};
      const player = {addEventListener() {},
        shadowRoot: failure === 'missing shadow root' ? null : {querySelectorAll: () => canvases[failure] ?? [webglCanvas]},
        ruffle: () => ({load: async () => {loads++; if (failure === 'load rejection') throw new Error('Movie fetch failed');}})};
      const nodes = {'#client': {dataset: {mode}, append() {}, replaceChildren() {removals++;}}, '#status': {textContent: 'Loading…'}};
      const probe = failure === 'unavailable' ? canvas2D : failure === 'lost probe' ? lostCanvas : webglCanvas;
      await vm.runInNewContext(script, {window: {addEventListener() {}, RufflePlayer: {newest: () => ({createPlayer: () => {creates++; return player;}})}},
        document: {createElement: tag => {assert.equal(tag, 'canvas'); return probe;}, querySelector: key => nodes[key]},
        URL, location: {href: 'https://example.test/'}, console: {error: error => errors.push(error)}});
      const preflight = ['unavailable', 'lost probe'].includes(failure);
      assert.equal(creates, preflight ? 0 : 1);
      assert.equal(loads, preflight ? 0 : 1);
      assert.equal(removals, 1);
      assert.equal(errors.length, 1);
      if (failure === 'load rejection') assert.match(nodes['#status'].textContent, /Movie fetch failed/);
      else {
        assert.match(nodes['#status'].textContent, /WebGL 2/);
        assert.match(nodes['#status'].textContent, /Enable hardware acceleration.*update your graphics driver/);
        if (!preflight) assert.match(nodes['#status'].textContent, /Ruffle did not initialize/);
      }
    });
  }
}
