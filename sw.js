/*
 * Espeto - service worker
 *
 * Faz tres coisas que o content script nao alcanca:
 *
 *   1. o atalho e o botao da barra (`chrome.commands` e `chrome.action` so
 *      existem aqui) - e o comando vai para TODOS os frames da aba, porque
 *      quem tem o mouse pode ser um iframe;
 *   2. o fallback de download, quando a CDN nao manda CORS e o `fetch` da
 *      pagina morre;
 *   3. a ponte com a pagina do DevTools, que roda num contexto que nao troca
 *      mensagem direta com content script.
 */

const espetar = (tab) => {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { fonte: 'espeto', tipo: 'espetar' })
    .catch(() => {}); // aba sem content script (chrome://, web store): ignora
};

chrome.action.onClicked.addListener(espetar);
chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'espetar') espetar(tab);
});

// ----------------------------------------------------- ponte do DevTools

// tabId -> porta. Uma janela de DevTools por aba.
const portas = new Map();

chrome.runtime.onConnect.addListener((porta) => {
  if (porta.name !== 'espeto-devtools') return;
  let dono = null;
  porta.onMessage.addListener((m) => {
    if (m && m.tipo === 'ola') { dono = m.tabId; portas.set(dono, porta); }
  });
  porta.onDisconnect.addListener(() => {
    if (dono !== null && portas.get(dono) === porta) portas.delete(dono);
  });
});

// ------------------------------------------------------------ mensagens

/* Um `replace` por proposito, e nenhum intervalo dentro de classe de
 * caractere. Juntar tudo numa classe so convida o `-` a virar intervalo no
 * meio dela - erro que ja custou caro na Fita, onde a classe engoliu digitos
 * e maiusculas e destruiu a data no nome do arquivo. Controle sai por codigo,
 * nao por regex; hifen e espaco ficam, porque nao sao ilegais em lugar
 * nenhum. */
const sanear = (nome) => {
  const limpo = String(nome || '')
    .split('').filter((c) => c.charCodeAt(0) > 31).join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[.\s]+/, '')
    .slice(0, 120);
  return limpo || `espeto-${Date.now()}.bin`;
};

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (!msg || msg.fonte !== 'espeto') return;
  const aba = remetente.tab && remetente.tab.id;

  if (msg.tipo === 'mando') {
    // Repassa para a aba inteira; cada frame compara com o proprio token.
    if (aba != null) {
      chrome.tabs.sendMessage(aba, { fonte: 'espeto', tipo: 'mando', token: msg.token })
        .catch(() => {});
    }
    return;
  }

  if (msg.tipo === 'abrir') {
    chrome.tabs.create({ url: msg.url, active: true, openerTabId: aba })
      .then(() => responder({ ok: true }), (e) => responder({ ok: false, erro: e.message }));
    return true;
  }

  if (msg.tipo === 'inspecionar') {
    const porta = aba != null && portas.get(aba);
    if (!porta) { responder({ ok: false, erro: 'DevTools fechado' }); return true; }
    porta.postMessage({ tipo: 'inspecionar' });
    responder({ ok: true });
    return true;
  }

  if (msg.tipo === 'baixar') {
    /* Aqui nao ha lista de hosts permitidos, ao contrario da Fita: a URL nao
     * veio de `postMessage` da pagina, veio do proprio content script, que a
     * leu de um no que o usuario apontou e confirmou na tela. A fronteira de
     * confianca e o olho dele. So o protocolo e checado, contra `javascript:`
     * e afins. */
    let alvo;
    try { alvo = new URL(msg.url); } catch { responder({ ok: false, erro: 'URL invalida' }); return true; }
    if (!/^https?:$/.test(alvo.protocol)) {
      responder({ ok: false, erro: `protocolo recusado: ${alvo.protocol}` });
      return true;
    }
    chrome.downloads.download({ url: alvo.href, filename: sanear(msg.nome), saveAs: false }, () => {
      const erro = chrome.runtime.lastError;
      responder({ ok: !erro, erro: erro && erro.message });
    });
    return true;
  }
});
