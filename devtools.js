/*
 * Espeto - a metade que fala com o painel Elements
 *
 * `inspect()` so existe dentro de `chrome.devtools.inspectedWindow.eval`, e
 * essa API so existe numa pagina de DevTools - contexto separado, que nao
 * troca mensagem direta com content script. Dai esta pagina invisivel: ela
 * abre uma porta com o service worker e fica esperando o aviso.
 *
 * O no escolhido nao viaja: referencia de DOM nao sobrevive a serializacao
 * entre contextos. O que viaja e um ATRIBUTO - o content script marca o
 * elemento com `data-espeto`, e a expressao abaixo o encontra do outro lado.
 * O DOM e o unico objeto que os dois contextos compartilham de verdade.
 */

const ACHAR = `(() => {
  const acha = (raiz) => {
    const d = raiz.querySelector('[data-espeto]');
    if (d) return d;
    for (const e of raiz.querySelectorAll('*')) {
      if (e.shadowRoot) { const x = acha(e.shadowRoot); if (x) return x; }
    }
    return null;
  };
  const n = acha(document) || document.querySelector('[data-espeto-host]');
  if (n) inspect(n);
  return !!n;
})()`;

const porta = chrome.runtime.connect({ name: 'espeto-devtools' });
porta.postMessage({ tipo: 'ola', tabId: chrome.devtools.inspectedWindow.tabId });

porta.onMessage.addListener((m) => {
  if (!m || m.tipo !== 'inspecionar') return;
  /* Sem `useContentScriptContext`: a API de linha de comando do console -
   * `inspect()` entre elas - so existe no mundo MAIN. O preco esta no
   * fallback acima: dali so se enxerga shadow root `open`, e por isso o
   * content script tambem marca o host mais externo quando o no mora dentro
   * de um `closed`. Melhor parar no host do que nao abrir nada. */
  chrome.devtools.inspectedWindow.eval(ACHAR, (achou, erro) => {
    if (erro || !achou) console.warn('[Espeto] nao achei o no marcado', erro || '');
  });
});
