# Espeto

O inspetor do DevTools mostra o elemento do **topo**. Quando a página põe uma
div transparente por cima da foto — overlay de clique, lightbox, camada de
tracking — é ela que você seleciona, e a imagem fica inalcançável pelo mouse.

O Espeto atravessa a pilha inteira e deixa você escolher a camada.

```
Alt+Shift+E  →  roda do mouse anda pelas camadas  →  Enter escolhe  →  uma tecla age
```

```
┌ ESPETO ───────────────────── 2/5 ┐
│   img#isca              descartada│  ← GIF 1x1 esticado: não entra na lista
│   div#capa                        │  ← o que o DevTools selecionaria
│ ▸ img#ouro               400x300  │  ← onde o cursor começa
│   div#iscaFundo                   │
│   div#palco                       │
│   html                            │
├───────────────────────────────────┤
│ c copiar URL   a abrir em aba nova│
│ b baixar       p copiar a imagem  │
│ s copiar o seletor                │
│ i mandar para o Elements          │
└───────────────────────────────────┘
```

## Instalação

`chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação →
selecione esta pasta.

Duas permissões: `downloads` (o plano B de download) e `clipboardWrite`.
Nenhuma `host_permissions`, nenhuma chamada para servidor de terceiro.

O atalho sugerido é `Alt+Shift+E`; se colidir com outra extensão, troque em
`chrome://extensions/shortcuts`. O botão da barra faz a mesma coisa.

## A ideia

**A informação nunca esteve escondida.** `document.elementsFromPoint(x, y)`
devolve a pilha inteira daquele ponto, em ordem de pintura, e não só o
primeiro elemento. O DevTools usa hit-testing comum e mostra o topo porque é
isso que a UI dele expõe — não porque o resto seja inacessível.

Então o Espeto monta a pilha, dá uma nota a cada camada e pré-seleciona a
melhor. O resto é navegação.

## O ouro nunca está no fim da pilha

Vale insistir nisto porque é o palpite errado mais natural: a pilha não é uma
escala de "quão enterrado". É ordem de pintura, e **ancestral vem depois de
descendente**. Os últimos itens são sempre `<body>` e `<html>`. Pegar o último
seleciona a página inteira.

No cenário do desenho acima, a pilha real sai assim:

```
img#isca → div#capa → img#ouro → div#iscaFundo → div#palco → html
```

O alvo bom mora no meio. Por isso a escolha é por evidência, não por posição.

## A nota olha a prova, não a tag

```
4  mídia com dimensão própria comprovada  (naturalWidth, videoWidth)
3  canvas, object, embed: pixels sem URL
2  background-image resolvido, iframe
1  folha com texto
0  caixa de layout, overlay, wrapper
```

E há descarte antes da nota: opacidade efetiva zero (o **produto** da cadeia
de ancestrais — `opacity` não herda em computed style, um pai com `opacity: 0`
deixa o filho com `1` computado e invisível), caixa menor que 8px de lado, e
imagem cujo `naturalWidth` denuncia um pixel de tracking.

## O golpe da isca

Quem quer atrapalhar automação já faz isso hoje: enfia um `<img>` decorativo
por cima da foto real e você baixa o lixo.

**Isca atrás do alvo perde sozinha.** Ela é pintada antes, logo aparece
*depois* na pilha, e entre pesos iguais ganha quem está mais à frente. Não
precisa de heurística nenhuma: a ordem de pintura já resolve.

**Isca 1x1 esticada por CSS perde na prova.** É o truque clássico — um GIF
transparente de um pixel com `width: 400px` no CSS, cobrindo a foto inteira.
O CSS mente, o `naturalWidth` não. Testado: a isca nem entra na lista.

**Isca boa ganha.** Um `<img>` real, visível, do mesmo tamanho, na frente da
foto certa é **indistinguível** dela. A diferença é intenção, não estrutura, e
não existe algoritmo para isso.

É exatamente por isso que a nota só decide **onde o cursor começa**. Quem
confirma é você, com a pilha inteira e a evidência de cada camada na tela — a
isca aparece escrita como `1x1` ou `data:image/gif` e você desce um degrau na
roda. Problema adversarial vira problema de UI, que é onde ele é solúvel.

## O modo bruto (tecla `f`)

`elementsFromPoint` é hit-testing, e hit-testing **pula** `pointer-events:
none`. Ironia: são justamente os overlays que já não atrapalham. Mas se o que
você quer for um deles, ele não aparece na pilha normal.

O modo bruto ignora hit-testing e testa retângulo por retângulo, todo elemento
do documento. Pega tudo, inclusive o que não recebe mouse. Custa uma varredura
de `*` por movimento do cursor, por isso é opcional.

No cenário de teste, é a única forma de alcançar a camada `pointer-events:
none`:

```
normal:  img#isca → div#capa → img#ouro → div#iscaFundo → div#palco → html
bruto:   div#iscaFundo → img#ouro → div#capa → img#isca → div#fantasma → ...
```

## As ações

| tecla | o que faz |
|---|---|
| `c` | copia a URL |
| `a` | abre o arquivo cru em aba nova |
| `b` | baixa |
| `p` | copia a **imagem** para o clipboard, para colar em outro app |
| `s` | copia o seletor |
| `i` | manda o nó para o painel Elements |

O seletor sai como CSS quando dá (`#ouro`) e como expressão JS quando o nó
mora em shadow DOM, porque ali seletor CSS não existe — `>>>` morreu e nenhuma
engine implementa travessia:

```js
document.querySelector("#casca").shadowRoot.querySelector("img")
```

## Decisões que não são óbvias

**O HUD é `pointer-events: none`, e por isso é só leitura.** Um painel
clicável apareceria no próprio `elementsFromPoint` e seria selecionável por
ele mesmo. Desligar hit-testing na árvore inteira resolve de uma vez, sem
filtro nenhum depois. O preço é navegar por teclado e roda — que é mais rápido
do que mirar em item de lista, então não é bem um preço.

**O clique é engolido enquanto o Espeto está ligado.** `mousedown`, `click`,
`contextmenu` e companhia, em fase de captura. Sem isso o primeiro clique abre
o lightbox da página, o layout muda, e a pilha que você escolheu deixa de
existir no mesmo instante. `Shift+roda` continua rolando a página.

**A pilha trava quando você anda nela.** Depois de girar a roda, um tremor de
12px no mouse não refaz a lista — senão a camada escolhida escaparia no
microssegundo entre decidir e apertar.

**O painel foge do cursor.** Mouse na direita, painel na esquerda. Fixo num
canto, ele cobriria exatamente a mídia que você está tentando escolher metade
das vezes.

**Shadow root fechado também é furado.** `chrome.dom.openOrClosedShadowRoot()`
só existe em content script — é a razão principal de isto ser uma extensão e
não um bookmarklet. Player de vídeo comercial adora `mode: 'closed'`.

**Cada árvore contribui só com o que é dela.** `elementsFromPoint` de um
shadow root devolve a pilha inteira do ponto, ancestrais de fora inclusive.
Sem filtrar por `getRootNode()`, o `<body>` da página entra antes do host que
o contém e a lista deixa de ser ordem de pintura.

**Baixar é tentado de dentro da página primeiro.** O `fetch` do content script
sai com a origem e o `Referer` da página, que é o que a CDN de mídia checa
antes de devolver 403. Em compensação ele obedece CORS; sem
`Access-Control-Allow-Origin` cai no `chrome.downloads.download` do service
worker, que baixa fora do alcance do CORS mas sem controle de header. Um dos
dois costuma passar.

(Nada de `credentials: 'include'`: cross-origin isso exige `Allow-Credentials`
na resposta e só **aumenta** a chance de falhar.)

**Um HUD por aba, mesmo com iframe.** Todos os frames recebem o comando de
ligar, mas só o que tem o mouse desenha: quem ganha o cursor anuncia um token
pelo service worker e os outros apagam o painel. Sem isso, página com embed
mostra dois painéis.

## A parte frágil

**O `i` depende do DevTools estar aberto**, e da metade que fala com ele. O
content script não consegue passar referência de nó para a página do DevTools
— contextos separados, nó não sobrevive a serialização. O canal é o DOM: o
elemento é marcado com `data-espeto` e `inspect()` o encontra do outro lado.

Só que o `eval` do DevTools roda no mundo MAIN, que enxerga apenas shadow root
`open`. Para um nó dentro de shadow `closed` — justamente os que o Espeto
alcança e o DevTools não — marcamos também o host mais externo, e o Elements
para nele. Melhor do que não abrir nada, mas é o único lugar onde a extensão
entrega menos do que encontrou.

**Iframe cross-origin coberto por overlay do frame de cima.** Quando o iframe
recebe o próprio `mousemove` — o caso comum — funciona sozinho, porque o
script roda em todos os frames. Se um overlay do frame pai come o evento, não
há como descer: mapear elemento `<iframe>` para `frameId` exige `webNavigation`
e ainda erra quando o frame navegou para longe do `src`. Ficou de fora.

**`<video>` com `src="blob:"`.** MSE: não existe arquivo único naquela URL, são
segmentos remontados em memória. O Espeto identifica o nó, lê o `src`, e diz
isso na tela em vez de oferecer um download que vai falhar. É outro problema,
e tem outra ferramenta.

## Diagnóstico

Nada acontece ao apertar o atalho: veja `chrome://extensions/shortcuts` —
colisão com outra extensão é silenciosa. Em `chrome://`, na Web Store e em
PDF não há content script, e não há o que fazer.

A camada que você quer não aparece na lista: tente `f`. Se aparecer, ela é
`pointer-events: none`. Se não, ela foi descartada por opacidade efetiva zero
ou por ter menos de 8px de lado.

`b` falhou nas duas rotas: o motivo sai no painel. `CORS barrou` seguido de
falha no worker costuma ser URL assinada que expirou entre a leitura e o
clique — mexa o mouse para refazer a pilha e tente de novo.
