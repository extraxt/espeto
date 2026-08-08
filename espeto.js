/*
 * Espeto - escolher a camada certa embaixo do cursor
 *
 * O inspetor do DevTools mostra o elemento do TOPO. Quando a pagina poe uma
 * div transparente por cima da foto - overlay de clique, lightbox, camada de
 * tracking - e ela que voce seleciona, e a foto fica inalcancavel pelo mouse.
 *
 * A informacao nunca esteve escondida: `elementsFromPoint` devolve a PILHA
 * inteira daquele ponto, em ordem de pintura, e nao so o primeiro. O DevTools
 * apenas nao expoe isso na UI. Entao o Espeto:
 *
 *   1. monta a pilha (furando shadow roots, inclusive os `closed`, que so
 *      `chrome.dom.openOrClosedShadowRoot` alcanca);
 *   2. da uma nota a cada camada pela EVIDENCIA de que ela e midia de verdade
 *      - `naturalWidth` de imagem, `videoWidth` de video, `background-image`
 *      resolvido - e nao pela tag, que qualquer um falsifica;
 *   3. pre-seleciona a melhor e deixa a roda do mouse andar pelas outras.
 *
 * O passo 3 e o que importa. Heuristica nenhuma sobrevive a uma pagina que
 * QUER enganar: um <img> real, visivel, do mesmo tamanho, na frente da foto
 * boa e indistinguivel dela - a diferenca e intencao, nao estrutura. Por isso
 * a nota so decide onde o cursor COMECA. Quem confirma e o humano, com a
 * pilha inteira e a evidencia de cada camada na tela.
 *
 * NADA daqui vaza para a pagina: o HUD vive num shadow root fechado, o
 * hospedeiro e `pointer-events: none` (logo, invisivel para o proprio
 * `elementsFromPoint`) e o script roda no mundo ISOLATED.
 */

(() => {
  'use strict';

  const MIN_LADO = 8;        // abaixo disso e spacer, nao camada
  const MIN_NATURAL = 8;     // imagem com menos que isso de lado e pixel de tracking
  const FRACAO_WRAPPER = 0.9; // acima disso da viewport, e wrapper de layout
  const RAIO_TRAVA = 12;     // px que o mouse precisa andar para destravar a pilha

  // Token proprio deste frame. Todos os frames da aba recebem o comando de
  // ativar, mas so um tem o mouse; quem ganha o mouse avisa, e os outros
  // apagam o HUD. Evita dois paineis na tela em pagina com iframe.
  const TOKEN = Math.random().toString(36).slice(2);

  let ativo = false;
  let bruto = false;         // modo forca bruta (ver `varrerBruto`)
  let pilha = [];            // [{ el, peso, det, wrapper }] em ordem de pintura
  let cursor = 0;
  let travado = false;       // usuario andou na pilha: nao refazer sem mexer o mouse
  let ponto = { x: 0, y: 0 };
  let escolhido = null;      // camada confirmada, com o menu de acoes aberto

  // ------------------------------------------------------------- a casca

  /* O HUD nao pode ser selecionavel por ele mesmo. `pointer-events: none` no
   * hospedeiro resolve de uma vez: hit-testing ignora a arvore inteira, entao
   * `elementsFromPoint` nunca o devolve e nao ha nada a filtrar depois. O
   * preco e que o painel e so leitura - toda a navegacao e por teclado e
   * roda, o que alias e mais rapido do que mirar em item de lista. */
  let hospedeiro = null, raiz = null, realce = null, rotulo = null, painel = null;

  const CSS = `
    .realce { position: fixed; box-sizing: border-box; z-index: 1;
              outline: 2px solid #ff2d55; background: rgba(255,45,85,.10); }
    .realce.fraco { outline-style: dashed; background: none; }
    .rotulo { position: fixed; z-index: 2; font: 11px/1.6 ui-monospace, Menlo, monospace;
              background: #ff2d55; color: #fff; padding: 0 6px; border-radius: 3px;
              white-space: nowrap; }
    .painel { position: fixed; z-index: 3; width: 340px; max-width: 44vw;
              font: 11px/1.55 ui-monospace, Menlo, Consolas, monospace;
              background: #14161acc; color: #e6e6e6; border: 1px solid #ffffff26;
              border-radius: 6px; padding: 6px 0; backdrop-filter: blur(6px);
              box-shadow: 0 8px 28px #0009; }
    .cab { display: flex; justify-content: space-between; gap: 8px;
           padding: 0 9px 5px; margin-bottom: 4px; color: #8b8f98;
           border-bottom: 1px solid #ffffff1a; }
    .cab b { color: #ff2d55; letter-spacing: .12em; font-weight: 700; }
    .linha { display: flex; gap: 6px; padding: 1px 9px; white-space: nowrap; }
    .linha.alvo { background: #ff2d5526; box-shadow: inset 2px 0 #ff2d55; }
    .linha.morta { opacity: .42; }
    .no { overflow: hidden; text-overflow: ellipsis; }
    .no i { color: #7aa2f7; font-style: normal; }
    .no s { color: #9ece6a; text-decoration: none; }
    .det { margin-left: auto; color: #e0af68; }
    .peso { color: #565a63; }
    .rodape { padding: 5px 9px 0; margin-top: 4px; color: #8b8f98;
              border-top: 1px solid #ffffff1a; white-space: normal; }
    .rodape kbd { color: #e6e6e6; background: #ffffff1a; border-radius: 3px;
                  padding: 0 3px; font: inherit; }
    .acao { display: flex; gap: 8px; padding: 1px 9px; }
    .acao u { color: #ff2d55; text-decoration: none; font-weight: 700; }
    .acao.off { opacity: .38; }
    .aviso { padding: 4px 9px 0; color: #e0af68; white-space: normal; }
  `;

  const montarCasca = () => {
    if (hospedeiro) return;
    hospedeiro = document.createElement('div');
    hospedeiro.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important;' +
      'pointer-events: none !important; z-index: 2147483647 !important;' +
      'display: block !important; opacity: 1 !important; visibility: visible !important;';
    raiz = hospedeiro.attachShadow({ mode: 'closed' });
    const estilo = document.createElement('style');
    estilo.textContent = CSS;
    realce = document.createElement('div');
    rotulo = document.createElement('div');
    painel = document.createElement('div');
    realce.className = 'realce';
    rotulo.className = 'rotulo';
    painel.className = 'painel';
    raiz.append(estilo, realce, rotulo, painel);
    document.documentElement.appendChild(hospedeiro);
  };

  /* Esconder o HOSPEDEIRO, e nao cada peca por dentro. Esvaziar o painel nao
   * o apaga: borda, fundo, padding e sombra sao dele, entao sem conteudo
   * sobra uma caixinha vazia no canto. Apagar a arvore inteira de uma vez
   * tambem garante que nenhum estado parcial - realce sem rotulo, rotulo sem
   * painel - consiga vazar para a tela.
   *
   * `setProperty` com `important` porque o cssText do hospedeiro declara
   * `display: block !important` para se defender do CSS da pagina; sem a
   * mesma prioridade, a atribuicao simples perderia para ele. */
  const mostrarCasca = (v) =>
    hospedeiro.style.setProperty('display', v ? 'block' : 'none', 'important');

  // ------------------------------------------------------- montar a pilha

  const shadowDe = (el) => {
    if (el.shadowRoot) return el.shadowRoot;
    try { return chrome.dom.openOrClosedShadowRoot(el); } catch { return null; }
  };

  /* Sobe um nivel atravessando fronteira de shadow root: do primeiro filho do
   * shadow tree o pai e `null`, e quem continua a arvore e o host. */
  const subir = (n) => {
    if (n.parentElement) return n.parentElement;
    const r = n.getRootNode();
    return r instanceof ShadowRoot ? r.host : null;
  };

  /* Ordem de pintura, do topo para o fundo - e por isso o "ouro" NUNCA esta no
   * fim: os ultimos itens sao sempre <body> e <html>, porque ancestral vem
   * depois de descendente. O alvo bom mora no meio.
   *
   * O conteudo de um shadow root e empilhado ANTES do host: `elementsFromPoint`
   * do documento devolve o host (retarget), e o que esta pintado ali dentro
   * esta por cima do fundo do proprio host. */
  const varrer = (x, y) => {
    const vistos = new Set();
    const saida = [];
    const anda = (r) => {
      for (const el of r.elementsFromPoint(x, y)) {
        /* `elementsFromPoint` de um shadow root nao devolve so a arvore dele:
         * devolve a pilha inteira daquele ponto, ancestrais de fora inclusive.
         * Sem este filtro o <body> da pagina entraria ANTES do host que o
         * contem, e a lista deixaria de ser ordem de pintura. Cada arvore so
         * contribui com o que e dela; o resto aparece no laco da sua. */
        if (el.getRootNode() !== r) continue;
        if (vistos.has(el)) continue;
        vistos.add(el);
        const sr = shadowDe(el);
        if (sr) anda(sr);
        saida.push(el);
      }
    };
    anda(document);
    return saida;
  };

  /* `elementsFromPoint` e hit-testing, e hit-testing PULA `pointer-events:
   * none`. Ironia: sao justamente os overlays que ja nao atrapalham. Mas se o
   * que voce quer for um deles, ele nao aparece na pilha normal - dai este
   * modo, que ignora hit-testing e testa retangulo por retangulo. Caro (uma
   * varredura de `*` por movimento), por isso e opcional, na tecla F. */
  const varrerBruto = (x, y) => {
    const saida = [];
    const anda = (r) => {
      for (const el of r.querySelectorAll('*')) {
        const sr = shadowDe(el);
        if (sr) anda(sr);
        for (const rc of el.getClientRects()) {
          if (x >= rc.left && x <= rc.right && y >= rc.top && y <= rc.bottom) {
            saida.push(el);
            break;
          }
        }
      }
    };
    anda(document);
    // Sem ordem de pintura aqui; profundidade e a melhor aproximacao de
    // "mais interno primeiro".
    const fundo = new Map();
    const prof = (el) => {
      let d = 0;
      for (let n = el; n; n = subir(n)) d++;
      fundo.set(el, d);
      return d;
    };
    saida.forEach(prof);
    return saida.sort((a, b) => fundo.get(b) - fundo.get(a));
  };

  // ---------------------------------------------------------- a evidencia

  /* `opacity` nao herda em computed style: um pai com `opacity: 0` deixa o
   * filho com `opacity: 1` computado, e ele continua invisivel. So o produto
   * da cadeia diz a verdade. */
  const opacidadeReal = (el) => {
    let o = 1;
    for (let n = el; n; n = subir(n)) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity) || 0;
      if (!o) return 0;
    }
    return o;
  };

  /* A nota nao olha a tag, olha a prova. Um <img> esticado por CSS a partir de
   * um GIF 1x1 - o truque classico de honeypot anti-scraping - tem
   * `naturalWidth` 1 e cai fora aqui, por mais que o CSS o infle ate cobrir a
   * foto inteira. Midia de verdade tem bytes atras dela.
   *
   *   4  midia com dimensao propria comprovada
   *   3  canvas/objeto: pixels sem URL
   *   2  background-image, iframe
   *   1  folha com texto
   *   0  caixa de layout, overlay, wrapper
   *
   * Retorna null quando a camada nem merece entrar na lista. */
  const evidenciar = (el) => {
    const cs = getComputedStyle(el);
    if (opacidadeReal(el) === 0) return null;

    const r = el.getBoundingClientRect();
    if (r.width < MIN_LADO || r.height < MIN_LADO) return null;

    const wrapper =
      r.width * r.height > innerWidth * innerHeight * FRACAO_WRAPPER;
    const nota = (peso, det) => ({ peso, det, wrapper });

    switch (el.tagName) {
      case 'IMG': {
        const { naturalWidth: nw, naturalHeight: nh } = el;
        if (nw && nh && (nw < MIN_NATURAL || nh < MIN_NATURAL)) return null;
        if (!el.currentSrc && !el.src) return null;
        return nw && nh ? nota(4, `${nw}x${nh}`) : nota(3, 'sem dimensao');
      }
      case 'VIDEO': {
        const fonte = el.currentSrc || el.src || '';
        if (fonte.startsWith('blob:')) return nota(4, 'blob: (MSE)');
        return el.videoWidth
          ? nota(4, `${el.videoWidth}x${el.videoHeight}`)
          : nota(3, 'sem frame');
      }
      case 'CANVAS': return nota(3, `${el.width}x${el.height}`);
      case 'OBJECT':
      case 'EMBED':  return nota(3, 'objeto');
      case 'IFRAME': return nota(2, 'iframe');
    }

    if (cs.backgroundImage !== 'none') {
      const u = urlDeFundo(cs.backgroundImage);
      return nota(2, u ? basename(u) || 'background' : 'background');
    }
    if (!el.childElementCount && el.textContent.trim()) return nota(1, 'texto');
    return nota(0, '');
  };

  const urlDeFundo = (valor) => {
    const m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(valor);
    if (!m || !m[2]) return null;
    try { return new URL(m[2], location.href).href; } catch { return null; }
  };

  const basename = (u) => {
    try { return new URL(u, location.href).pathname.split('/').pop() || null; }
    catch { return null; }
  };

  /* Onde o cursor COMECA. Peso manda; area so desempata entre iguais, e como
   * FAIXA, nao como "menor vence": wrapper do tamanho da tela vai para o fim,
   * mas entre dois candidatos legitimos ganha o que esta mais a FRENTE - e por
   * isso que uma isca escondida ATRAS da foto perde sozinha, sem heuristica
   * nenhuma, so pela ordem de pintura. */
  const melhor = (lista) => {
    let i = 0;
    for (let j = 1; j < lista.length; j++) {
      const a = lista[i], b = lista[j];
      if (b.peso > a.peso) { i = j; continue; }
      if (b.peso === a.peso && a.wrapper && !b.wrapper) i = j;
    }
    return i;
  };

  const remontar = () => {
    const crus = bruto ? varrerBruto(ponto.x, ponto.y) : varrer(ponto.x, ponto.y);
    pilha = [];
    for (const el of crus) {
      if (el === hospedeiro) continue;
      const ev = evidenciar(el);
      if (ev) pilha.push({ el, ...ev });
    }
    cursor = pilha.length ? melhor(pilha) : 0;
  };

  // -------------------------------------------------------------- desenho

  const nomeCurto = (el) => {
    const t = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cl = el.classList.length ? `.${el.classList[0]}` : '';
    const sombra = el.getRootNode() instanceof ShadowRoot ? '⌁' : '';
    return { t, id, cl, sombra };
  };

  const linhaDe = (item, alvo) => {
    const l = document.createElement('div');
    l.className = 'linha' + (alvo ? ' alvo' : '') + (item.peso ? '' : ' morta');
    const { t, id, cl, sombra } = nomeCurto(item.el);
    const no = document.createElement('span');
    no.className = 'no';
    no.append(sombra ? `${sombra} ` : '', t);
    if (id) { const e = document.createElement('i'); e.textContent = id; no.append(e); }
    if (cl) { const e = document.createElement('s'); e.textContent = cl; no.append(e); }
    const det = document.createElement('span');
    det.className = 'det';
    det.textContent = item.det;
    const peso = document.createElement('span');
    peso.className = 'peso';
    peso.textContent = '·'.repeat(item.peso) || '';
    l.append(no, det, peso);
    return l;
  };

  const rodape = (html) => {
    const d = document.createElement('div');
    d.className = 'rodape';
    d.innerHTML = html;
    return d;
  };

  const desenhar = (aviso) => {
    montarCasca();
    mostrarCasca(true);
    if (!pilha.length) {
      realce.style.display = rotulo.style.display = 'none';
      painel.replaceChildren(rodape('nada sob o cursor'));
      posicionarPainel();
      return;
    }

    const item = escolhido || pilha[cursor];
    const r = item.el.getBoundingClientRect();
    realce.style.cssText =
      `display:block; left:${r.left}px; top:${r.top}px; ` +
      `width:${r.width}px; height:${r.height}px`;
    realce.classList.toggle('fraco', !item.peso);

    const { t, id, cl } = nomeCurto(item.el);
    rotulo.textContent = `${t}${id}${cl}${item.det ? '  ' + item.det : ''}`;
    rotulo.style.display = 'block';
    const acima = r.top > 20;
    rotulo.style.left = `${Math.max(2, Math.min(r.left, innerWidth - 240))}px`;
    rotulo.style.top = `${acima ? r.top - 18 : Math.min(r.bottom + 2, innerHeight - 18)}px`;

    painel.replaceChildren();
    const cab = document.createElement('div');
    cab.className = 'cab';
    const marca = document.createElement('b');
    marca.textContent = 'ESPETO';
    const conta = document.createElement('span');
    conta.textContent =
      `${cursor + 1}/${pilha.length}${bruto ? ' · bruto' : ''}`;
    cab.append(marca, conta);
    painel.append(cab);

    if (escolhido) {
      painel.append(linhaDe(escolhido, true));
      for (const a of acoesDe(escolhido.el)) {
        const d = document.createElement('div');
        d.className = 'acao' + (a.ok ? '' : ' off');
        const k = document.createElement('u');
        k.textContent = a.tecla;
        d.append(k, a.nome);
        painel.append(d);
      }
      if (aviso) {
        const v = document.createElement('div');
        v.className = 'aviso';
        v.textContent = aviso;
        painel.append(v);
      }
      painel.append(rodape('<kbd>esc</kbd> volta'));
    } else {
      // Janela deslizante: a pilha inteira nao cabe em pagina de app moderno.
      const MAX = 12;
      let ini = Math.max(0, Math.min(cursor - (MAX >> 1), pilha.length - MAX));
      if (ini < 0) ini = 0;
      const fim = Math.min(pilha.length, ini + MAX);
      if (ini > 0) painel.append(rodape(`↑ mais ${ini}`));
      for (let i = ini; i < fim; i++) painel.append(linhaDe(pilha[i], i === cursor));
      if (fim < pilha.length) painel.append(rodape(`↓ mais ${pilha.length - fim}`));
      painel.append(rodape(
        '<kbd>roda</kbd>/<kbd>↑↓</kbd> camada · <kbd>enter</kbd>/clique escolhe · ' +
        '<kbd>f</kbd> bruto · <kbd>shift+roda</kbd> rola · <kbd>esc</kbd> sai',
      ));
    }
    posicionarPainel();
  };

  /* O painel foge do cursor: com o mouse na direita ele vai para a esquerda.
   * Se ficasse fixo num canto, cobriria exatamente a midia que voce esta
   * tentando escolher metade das vezes. */
  const posicionarPainel = () => {
    const direita = ponto.x > innerWidth / 2;
    const baixo = ponto.y > innerHeight / 2;
    painel.style.left = direita ? '12px' : 'auto';
    painel.style.right = direita ? 'auto' : '12px';
    painel.style.top = baixo ? '12px' : 'auto';
    painel.style.bottom = baixo ? 'auto' : '12px';
  };

  const apagar = () => {
    if (!raiz) return;
    mostrarCasca(false);
    realce.style.display = rotulo.style.display = 'none';
    painel.replaceChildren();
  };

  // --------------------------------------------------------- os ativos

  /* Do no para o ativo. `currentSrc`, nunca `src`: com `srcset`/<picture> o
   * `src` e o fallback, e nao o arquivo que esta na sua tela. Canvas e o caso
   * sem URL nenhuma - o elemento E os pixels. */
  const ativoDe = (el) => {
    switch (el.tagName) {
      case 'IMG':
        return { tipo: 'url', url: el.currentSrc || el.src };
      case 'VIDEO': {
        const u = el.currentSrc || el.src ||
          el.querySelector('source')?.src || '';
        return u ? { tipo: 'url', url: u } : null;
      }
      case 'IFRAME':
        return el.src ? { tipo: 'url', url: el.src } : null;
      case 'CANVAS':
        return { tipo: 'bytes', blob: () => new Promise((r) => el.toBlob(r)) };
      default: {
        const u = urlDeFundo(getComputedStyle(el).backgroundImage);
        return u ? { tipo: 'url', url: u } : null;
      }
    }
  };

  const eMSE = (el) => {
    const a = ativoDe(el);
    return !!(a && a.tipo === 'url' && a.url.startsWith('blob:'));
  };

  const acoesDe = (el) => {
    const a = ativoDe(el);
    const tem = !!a && !eMSE(el);
    return [
      { tecla: 'c', nome: 'copiar URL', ok: tem },
      { tecla: 'a', nome: 'abrir em aba nova', ok: tem },
      { tecla: 'b', nome: 'baixar', ok: !!a && !eMSE(el) },
      { tecla: 'p', nome: 'copiar a imagem', ok: !!a && !eMSE(el) },
      { tecla: 's', nome: 'copiar o seletor', ok: true },
      { tecla: 'i', nome: 'mandar para o Elements', ok: true },
    ];
  };

  // --------------------------------------------------------- o seletor

  const umPasso = (el) => {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
    let p = el.tagName.toLowerCase();
    const pai = el.parentElement;
    if (pai) {
      const iguais = [...pai.children].filter((c) => c.tagName === el.tagName);
      if (iguais.length > 1) p += `:nth-of-type(${iguais.indexOf(el) + 1})`;
    }
    return p;
  };

  /* Dentro de shadow DOM nao existe seletor CSS: `>>>` morreu e nenhuma
   * engine implementa travessia. O que serve de verdade e a expressao JS que
   * chega la - colavel no console, usavel em script. */
  const seletorDe = (el) => {
    const trechos = [];
    let n = el;
    while (n) {
      const r = n.getRootNode();
      const partes = [];
      let m = n;
      while (m && m.getRootNode() === r) {
        const passo = umPasso(m);
        partes.unshift(passo);
        if (passo[0] === '#') break;
        m = m.parentElement;
      }
      trechos.unshift(partes.join(' > '));
      n = r instanceof ShadowRoot ? r.host : null;
    }
    if (trechos.length === 1) return trechos[0];
    return trechos
      .map((s, i) => (i ? `.shadowRoot.querySelector(${JSON.stringify(s)})`
                        : `document.querySelector(${JSON.stringify(s)})`))
      .join('');
  };

  // ---------------------------------------------------------- as acoes

  const semControle = (s) =>
    s.split('').filter((c) => c.charCodeAt(0) > 31).join('');

  /* Hifen e espaco ficam: nao sao ilegais em SO nenhum, e mexer neles so
   * desfigura o nome. Caractere de controle sai por codigo, fora da regex -
   * intervalo dentro de classe e onde nascem os acidentes. */
  const nomeDeArquivo = (url, mime) => {
    let nome = semControle(basename(url) || '');
    nome = nome.split('?')[0].replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
    if (!/\.[a-z0-9]{2,5}$/i.test(nome)) {
      const ext = (mime || '').split('/')[1]?.split('+')[0] || 'bin';
      nome = `${nome || 'espeto-' + Date.now()}.${ext}`;
    }
    return nome;
  };

  /* Buscar daqui, e nao do service worker, porque o `fetch` do content script
   * sai com a ORIGEM e o Referer da pagina - que e exatamente o que a CDN de
   * midia checa antes de devolver 403. Em compensacao ele obedece CORS: se a
   * CDN nao mandar `Access-Control-Allow-Origin`, cai no
   * `chrome.downloads.download` do worker, que baixa fora do alcance do CORS
   * mas sem controle nenhum de header.
   *
   * Nada de `credentials: 'include'`: cross-origin isso EXIGE
   * `Allow-Credentials` na resposta e so aumenta a chance de falhar. */
  const buscar = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.blob();
  };

  const salvarBlob = (blob, nome) => {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = nome;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
  };

  /* Clipboard so aceita PNG. `createImageBitmap` a partir do blob que ja esta
   * na memoria nao encosta em CORS - a conversao por <canvas> + <img> remoto
   * daria taint e morreria no `toBlob`. */
  const paraPng = async (blob) => {
    if (blob.type === 'image/png') return blob;
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    cv.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return cv.convertToBlob({ type: 'image/png' });
  };

  const executar = async (tecla, item) => {
    const el = item.el;
    const a = ativoDe(el);

    if (tecla === 's') {
      await navigator.clipboard.writeText(seletorDe(el));
      return 'seletor copiado';
    }
    if (tecla === 'i') {
      marcarParaInspecao(el);
      const r = await chrome.runtime.sendMessage({ fonte: 'espeto', tipo: 'inspecionar' });
      return r && r.ok ? 'mandado para o Elements'
                       : 'abra o DevTools primeiro (o painel Elements)';
    }

    if (!a) return 'esta camada nao tem arquivo atras dela';
    if (a.tipo === 'url' && a.url.startsWith('blob:'))
      return 'blob: — video por MSE, nao ha arquivo unico nessa URL';

    if (tecla === 'c') {
      await navigator.clipboard.writeText(a.url);
      return 'URL copiada';
    }
    if (tecla === 'a') {
      await chrome.runtime.sendMessage({ fonte: 'espeto', tipo: 'abrir', url: a.url });
      return 'aberta em aba nova';
    }
    if (tecla === 'b') {
      if (a.tipo === 'bytes') {
        const blob = await a.blob();
        if (!blob) return 'canvas vazio ou protegido';
        salvarBlob(blob, `espeto-${Date.now()}.png`);
        return 'canvas salvo';
      }
      try {
        const blob = await buscar(a.url);
        salvarBlob(blob, nomeDeArquivo(a.url, blob.type));
        return 'baixado pela pagina';
      } catch (e) {
        const r = await chrome.runtime.sendMessage({
          fonte: 'espeto', tipo: 'baixar', url: a.url, nome: nomeDeArquivo(a.url),
        });
        if (r && r.ok) return 'CORS barrou; baixado pelo navegador';
        return `falhou: ${(r && r.erro) || e.message}`;
      }
    }
    if (tecla === 'p') {
      const png = a.tipo === 'bytes'
        ? a.blob().then(paraPng)
        : buscar(a.url).then(paraPng);
      // A promessa vai DENTRO do ClipboardItem: e o unico jeito de o Chrome
      // manter o gesto do usuario valido durante o download.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      return 'imagem copiada';
    }
    return null;
  };

  /* O content script nao consegue passar referencia de no para a pagina do
   * DevTools - sao contextos separados e no nao sobrevive a serializacao. O
   * DOM, porem, e compartilhado: um atributo e o canal.
   *
   * A pagina do DevTools avalia no mundo MAIN, que so enxerga shadow root
   * `open`. Para no dentro de shadow `closed`, marcamos tambem o host mais
   * externo alcancavel - o Elements para no host em vez de nao abrir nada. */
  const marcarParaInspecao = (el) => {
    document.querySelectorAll('[data-espeto], [data-espeto-host]')
      .forEach((n) => { n.removeAttribute('data-espeto'); n.removeAttribute('data-espeto-host'); });
    el.setAttribute('data-espeto', '');
    let fechado = null;
    for (let n = el; n; ) {
      const r = n.getRootNode();
      if (!(r instanceof ShadowRoot)) break;
      if (r.mode === 'closed') fechado = r.host;
      n = r.host;
    }
    if (fechado) fechado.setAttribute('data-espeto-host', '');
    setTimeout(() => {
      el.removeAttribute('data-espeto');
      if (fechado) fechado.removeAttribute('data-espeto-host');
    }, 30000);
  };

  // ------------------------------------------------------------ eventos

  /* Contador de sessao. O desligamento depois de uma acao e adiado em ~1s
   * para dar tempo de ler o aviso no painel, e nesse intervalo o usuario pode
   * ter saido no Esc e ligado de novo - o timer atrasado apagaria a sessao
   * NOVA. Comparar a geracao faz o timer velho virar no-op. */
  let geracao = 0;

  const ligar = (v) => {
    if (ativo === v) return;
    geracao++;
    ativo = v;
    escolhido = null;
    travado = false;
    bruto = false;
    if (v) {
      montarCasca();
      remontar();
      desenhar();
    } else {
      apagar();
    }
  };

  // Enquanto o Espeto esta ligado, o clique e NOSSO. Sem isso o primeiro
  // clique abre o lightbox da pagina, o layout muda e a pilha que voce
  // escolheu deixa de existir no mesmo instante.
  const ENGOLIR = ['mousedown', 'mouseup', 'click', 'dblclick',
                   'pointerdown', 'pointerup', 'contextmenu', 'auxclick'];

  const engolir = (e) => {
    if (!ativo) return;
    /* So clique de gente. `e.isTrusted` e false em qualquer evento disparado
     * por codigo - inclusive o `a.click()` que o proprio `salvarBlob` usa
     * para baixar. Sem esta linha o Espeto cancelava o proprio download: o
     * `preventDefault` daqui mata a acao padrao do <a download> e nao sobra
     * erro nenhum, so o arquivo que nunca aparece.
     *
     * Filtrar aqui, e nao marcar o clique com uma flag, porque a regra certa
     * e essa mesma: o que se quer engolir e a reacao da PAGINA ao clique do
     * usuario, e clique sintetico nao vem do usuario. */
    if (!e.isTrusted) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'click' || e.type === 'contextmenu') confirmar();
  };

  const confirmar = () => {
    if (!pilha.length) return;
    if (escolhido) return;
    escolhido = pilha[cursor];
    desenhar();
  };

  const andar = (d) => {
    if (!pilha.length || escolhido) return;
    cursor = Math.max(0, Math.min(pilha.length - 1, cursor + d));
    travado = true;
    desenhar();
  };

  addEventListener('mousemove', (e) => {
    if (!ativo) return;
    const dx = e.clientX - ponto.x, dy = e.clientY - ponto.y;
    if (travado && dx * dx + dy * dy < RAIO_TRAVA * RAIO_TRAVA) return;
    ponto = { x: e.clientX, y: e.clientY };
    travado = false;
    if (escolhido) return;
    chrome.runtime.sendMessage({ fonte: 'espeto', tipo: 'mando', token: TOKEN });
    remontar();
    desenhar();
  }, true);

  addEventListener('wheel', (e) => {
    if (!ativo || e.shiftKey) return; // shift+roda continua rolando a pagina
    e.preventDefault();
    andar(e.deltaY > 0 ? 1 : -1);
  }, { capture: true, passive: false });

  addEventListener('keydown', async (e) => {
    if (!ativo) return;
    const k = e.key.toLowerCase();

    if (k === 'escape') {
      e.preventDefault(); e.stopPropagation();
      if (escolhido) { escolhido = null; desenhar(); } else ligar(false);
      return;
    }
    if (!escolhido) {
      if (k === 'arrowdown' || k === 'arrowup') {
        e.preventDefault(); e.stopPropagation();
        andar(k === 'arrowdown' ? 1 : -1);
        return;
      }
      if (k === 'enter') { e.preventDefault(); e.stopPropagation(); confirmar(); return; }
      if (k === 'f') {
        e.preventDefault(); e.stopPropagation();
        bruto = !bruto; remontar(); desenhar();
        return;
      }
      return;
    }

    if (!'cabpsi'.includes(k) || k.length !== 1) return;
    e.preventDefault(); e.stopPropagation();
    const alvo = escolhido;
    try {
      const msg = await executar(k, alvo);
      if (!msg) return;
      escolhido = alvo;
      desenhar(msg);
      const minha = geracao;
      if (!/falhou|nao ha|nao tem|primeiro/.test(msg)) {
        setTimeout(() => { if (geracao === minha) ligar(false); }, 900);
      }
    } catch (err) {
      desenhar(`falhou: ${err.message}`);
    }
  }, true);

  for (const t of ENGOLIR) addEventListener(t, engolir, true);

  addEventListener('scroll', () => { if (ativo && !escolhido) { remontar(); desenhar(); } }, true);
  addEventListener('blur', () => ligar(false));

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.fonte !== 'espeto') return;
    if (msg.tipo === 'espetar') ligar(!ativo);
    // Outro frame ganhou o mouse: apaga o painel daqui, mas continua ligado -
    // basta o mouse voltar para este frame que ele se redesenha.
    if (msg.tipo === 'mando' && msg.token !== TOKEN && ativo && !escolhido) apagar();
  });
})();
