# Chog Wave — blueprint do duelo e das cartas

Destinado a ser implementado do zero. Nada aqui depende do código atual; onde o código atual presta, eu digo "carrega"; onde ele é peso morto, eu digo "mata".

**Números marcados como [medido]** saíram de testes rodados neste repositório, não de estimativa.

---

## 0. Estado da árvore hoje (leia antes de copiar qualquer coisa)

**Correção de 2026-10-11, fim do dia:** uma sessão paralela reescreveu o repo inteiro no meio deste
documento. O motor velho (`shared/src/field.ts`, `duel.ts`, `custom.ts`, `moves.ts`) **foi apagado** e
substituído por `shared/src/sf/` (element, card, field, custom, boss, stats, buster, busting, party,
clock, session, view), exportado como `SF`. O novo motor **já remove a grade de colocação** (a carta
mira pelo file onde você está, como Star Force) e **já tem** a câmera vertical atrás do Chog, o grado
de Busting e o Buster. Os caminhos de arquivo citados nas seções 11 e 12 abaixo são do motor velho;
o *design* continua de pé, os paths não. Antes de implementar qualquer coisa aqui, leia `sf/` primeiro.

A working tree esteve **no meio de uma edição minha** quando este documento foi escrito, e o repo não
é git — não há como desfazer. Especificamente:

- Largura do chão virou dinâmica (`FieldState.cols`) mas **o cliente ainda tem um `((c.col % 3) + 3) % 3`** em `duel.ts:668` (mapping da carta pro tiro visual). O de `moveTo` já foi corrigido.
- O laser do duelo foi ligado no servidor (`session.beam`, `LASER_CHARGE`, `DuelAction 'laser'`, `DuelPlayerView.laser`) e no dispatch do cliente, mas **faltam a tecla `L`, o método `beam()` e o handler `onLaser`**. Está compilando e os testes passam; só não há input.
- O servidor que estava de pé em `:8799` é **anterior** a essas edições. Cliente (vite) e servidor divergem agora.

Trate o código como referência de comportamento, não como fonte de verdade.

---

## 1. O modelo, em uma frase

Um duelo é **uma fileira de 3–6 colunas que você pisa para não apanhar, e uma grade 3×2 onde você monta o golpe que devolve** — e as duas coisas são o mesmo espaço visto de dois lados.

Cinco objetos bastam:

| Objeto | O que é | Onde mora |
|---|---|---|
| **field** | o chão: `cols` files × `LANES` lanes, boss numa lane do fundo, jogador em uma file | servidor, puro |
| **volley** | o aviso: `{files[], ms, damage, move}` anunciado e depois cumprido | servidor |
| **hand** | 6 cartas candidatas, cada uma numa célula do painel 3×2 | servidor dealt, cliente mostra |
| **program** | fila de escolhas + onde cada carta foi postada na grade | cliente constrói, servidor re-valida |
| **draft** | o estado do programa, com as regras de o que pode ser clicado | `shared`, dos dois lados |

**Invariante que sustenta o resto:** o cliente nunca afirma dano. Ele manda `{queue: células em ordem, placements: onde cada carta senta}`; o servidor **re-joga a fila pelo mesmo `canSelect` que o painel usa** e só então decide. Se a regra de UI e a de validação divergirem, o jogador sente trapaça. É a única razão pela qual `shared/` existe.

---

## 2. O campo

```
lanes:  0 1 2   ← boss (a dele)
        3 4     ← jogador (o dele)
files:  0 .. cols-1   (a coluna, atravessando as duas metades)
```

- **`cols` = a largura da grade de link do Chog mais largo em campo.** Não é constante. Um Chog de grade 3 luta em 3 files; um de grade 5, em 5. Isso é deliberado: *espaço de esquiva é progressão*, e a grade já cresce por traço + tier + idade de mint.
- Consequência obrigatória: **tudo que clampa a file tem que ler `cols`**, nunca um 3 literal. (Foi o bug que mordeu hoje: `clamp(file, 0, 2)` no cliente tornava o file 3 inalcançável, então uma salva marcando 0-1-2 era dano garantido, sem jogada possível.)
- Uma carta só acerta o boss se o **footprint dela cobrir a file onde o boss está**. Carta que erra a file voa reto e não faz nada — visivelmente. Não existe "66% de acertar".
- Projétil anda por lane com `LANE_MS = 90` [medido]; o dano é aplicado por lane atravessada, então uma carta alta dá múltiplos `hits`.

---

## 3. Os relógios

```
telegraphMs = clamp( (1100 − 120·(phase−1)) · move.tell · scale,  min 300 ms )
quietMs     = clamp( (3600 − 450·(phase−1))            · scale,  min 900 ms )

scale = min( 1.6,  1 / (1 + 0.05·levelGap + 0.09·(difficulty − 1)) )
```

- **`phase` 1..4 vem da vida do boss** (`1 + floor(4·(1−hp/max))`): um boss morrendo bate mais cedo e mais seguido. Era o único eixo que existia.
- **`levelGap` = nível do inimigo − média dos corpos em campo.** É o eixo que o jogador controla: entrar abaixo do level do conteúdo custa tempo de leitura; entrar acima devolve. A média (não o máximo) é deliberada: quatro Chogs não podem carregar um de nível 2 por uma janela que ele nunca teve.
- **`difficulty` 1..6** = o tier do mapa (dungeon) ou `1 + floor(wave/25)` na rua.
- **Piso de 300 ms é uma decisão de design, não um ajuste.** Abaixo disso a esquiva não é tardia, é loteria. O jogo pode ficar brutal até a linha e nunca passar.
- `move.tell` (abaixo) é o multiplicador por golpe: um SWEEP é lido mais cedo que um JAB.
- Treino: telegraph ×1.5, quiet ×1.35, gauge ×0.7, e **o boneco é sempre calibrado no level do jogador** (`levelGap = 0`). Um simulador de treino que trapaceia na leitura não treina nada.
- Gauge do Custom Screen: `7000 ms`, começando em `FIRST_READY = 0.45` [medido].

**Leitura como grandeza, não como sensação:** `readRate(window) = clamp((window − 250) / 1250, 0, 1)` e `dodgeExposure(window) = (1 − read) / (1 − read(980 ms))`. Isso deixa o modelo de pacing dizer "entrar 6 níveis abaixo custa ~2× a integridade" em vez de "fica mais difícil".

---

## 4. O programa

**Painel:** 3 linhas × 2 colunas = 6 candidatas por mão. Fila de até `queueSlots` (3→6 com o level).

**Travas — só quatro, e cada uma precisa de motivo legível na UI:** `empty` · `already` (essa cópia já foi escolhida) · `full` · e nada mais. **A linha é pagamento, não portão**: uma carta fora da sequência pode ser escolhida, ela só ganha menos. (O sistema já teve um portão de linha que escurecia cartas — foi a causa direta de "não consigo selecionar uma carta".)

**A linha (walk):** cada escolha consecutiva que compartilha linha **ou** coluna com a anterior paga `+6%` (`LINE_STEP = 0.06`). Cartas brancas sempre linkam e ignoram `already`. Um tour completo do painel (`0,1,3,5,4,2`) vale 5 elos = ×1.30.

**Escala do dano:**

```
scale = gridMultiplier · walkMultiplier · affinity · (crit ? 1.6 : 1) · (amp ? 1.25 : 1)
damage(per carta) = power · hits · matchup · chainMultiplier(run) · scale · partyLink
```

`matchup` = 2 super eficaz / 0.5 resistido. `chainMultiplier` = `[1, 1.15, 1.3, 1.45, 1.6]` por repetição do mesmo elemento. O `partyLink` é o cross-link (abaixo).

**EXECUTE auto-posta o que ficou na fila.** Então a UI não pode exigir "poste pelo menos uma carta": isso pede um passo que o jogador não deve. A prévia tem que mostrar o que **aquele aperto de tecla** vai render.

---

## 5. Os verbos de carta

**Este é o achado mais caro do projeto.** 42 das 54 cartas anunciam um efeito (`pierce/stun/drain/knock/chain`) e **nada no código lia o valor** — o campo anexava `effect` no evento de impacto e a UI mostrava no tooltip. Cartas eram rótulos.

Especificação do que cada verbo significa, e onde ele mora:

| Verbo | Regra | Dono do estado |
|---|---|---|
| **PIERCE** | atravessa o file bloqueado (muro do FRONT) e qualquer armadura de file | `field` (sem estado novo) |
| **KNOCK** | arrasta o boss para a file de onde a carta saiu | `field` (é a posição do boss) |
| **CHAIN** | conta como o elemento que você **já está rodando**, em vez do seu próprio: emenda a corrida em vez de quebrá-la. O dano continua no elemento da carta | `field` (medidor de chain) |
| **STUN** | atrasa o **próximo aviso** em 700 ms, acumulado até 1500 ms. Nunca atrasa uma salva já no ar | sessão (relógio da volley) |
| **DRAIN** | devolve 15% do dano como integridade para **quem atirou** | sessão (vida por corpo) |

Por que essa divisão: os três primeiros são fatos sobre o chão; os dois últimos precisam de relógio e de corpos, que o chão não tem.

**STUN é a resposta de design ao `levelGap`.** Quando a janela de leitura encolhe, o jogador rouba milissegundos do inimigo. Sem isso, "indesviável" só tem uma saída: números maiores.

---

## 6. Vocabulário do chefão

Um arquétipo com **um** comportamento é o mesmo boss com mais vida. Cada arquétipo tem um *pool* de golpes, e o golpe escolhe as files:

| Golpe | Marca | `tell` | fase mín. | prof. mín. |
|---|---|---|---|---|
| JAB | a file dele | 1.00 | 1 | 1 |
| CROSS | **a sua** file | 1.05 | 1 | 1 |
| SWEEP | a dele + a vizinha | 1.20 | 1 | 2 |
| HAMMER | o centro do chão | 0.95 | 1 | 2 |
| PINCER | a sua + a dele | 1.10 | 3 | 3 |
| FLANK | tudo menos a dele | 1.25 | 3 | 4 |

- Pools: `surge: [SWEEP, CROSS, JAB, PINCER]` · `baron: [HAMMER, JAB, SWEEP, PINCER]` · `spark: [JAB, CROSS, SWEEP, FLANK]` · `glitch: [JAB, CROSS, SWEEP, HAMMER]` · `front: [JAB, CROSS, SWEEP, HAMMER]` + o muro · `mirror: [CROSS, JAB, PINCER]` + reflete o seu último programa · `dummy: [JAB]`.
- **A primeira entrada do pool é a assinatura e pesa 2,2×.** Gate de dificuldade **adiciona vocabulário, não tira identidade**: um SURGE de tier 1 ainda é um SURGE.
- **Nenhum golpe deve multiplicar o dano.** Um golpe que marca 3 files já custa 3× a chance de acertar; escalar o dano por cima é dupla contagem — e quebra o invariante "o campo paga exatamente o que o mapa declarou". (Eu cometi isso e os testes pegaram.)
- Identidades que não são golpe: o muro do FRONT, o centro fixo do BARON, o reflexo do MIRROR.

---

## 7. As cartas (população real hoje)

**54 cartas**, 6 elementos (`burn frost volt wave prism void`), schema:

```ts
{ id, name, element, shape: [dr,dc][], power, hits, effect, waveDrain, klass?: 'S'|'M'|'G' }
```

- Formas: `dot` 1 · `h2`/`v2` 2 · `l`/`bar3` 3 · `sq` 4 · `plus` 5, e as fundidas vão até 6 células.
- Distribuição de efeito [medido]: `pierce 13 · stun 10 · drain 7 · knock 6 · chain 6 · none 12`.
- **`waveDrain` é negativo no VOID** (`nullfur −1`, `eclipse −2`, `signaldeath −4`, `ga_quietdeath −5`): carta VOID **sobe** a onda da cidade. É a melhor ideia do conjunto e precisa de mais cartas assim — o deck inteiro deveria poder *empurrar* o medidor público, não só baixá-lo.
- Curva base (18 cartas): burn 90×1/70×2/130×3 · frost 70×1/95×2/110×4 · volt 80×1/120×2/150×3 · wave 60×1/85×3/120×4 · prism 75×1/100×2/160×3 · void 140×1/175×2/240×2. **VOID é dano alto, `waveDrain` negativo e nenhum efeito de controle barato** — a cor do "custo para a cidade".
- **9 fusões** (`ga_*`): seis triades (as três cartas do mesmo elemento numa fila) + três cruzadas com dica em prosa — `staticbloom` ("algo que morde, algo que imobiliza, algo que dobra"), `lasttrain` (a maré inteira), `moltenmirror` ("comece um fogo e olhe dentro dele"). Poder 220–460, 2–6 hits. **A primeira vez que uma receita dispara ela é grant permanente** — esse é o melhor gancho de progressão do jogo e está pronto.

**Regras de deck** (`folderRules`): tamanho ≥ 12 · cópias por carta vêm do traço **Body** · `megaCap`/`gigaCap` por loadout + licença · `fusedCap = 1 + giga + licença` · **a fraqueza do Chog é banida do folder** · fundidas têm limite 1 por carta.

**O que carregar:** o schema, as triades, `waveDrain` negativo, banir a fraqueza, e "receita descobida = carta permanente". **O que matar:** 18 cartas base é pouco para 6 elementos × 3 classes — o conjunto precisa de ~40 cartas comuns para o folder ser uma decisão e não um formulário.

---

## 8. Party (o que já funciona e é raro)

- **Cross-link**: volleys que aterrissaram em janela (`LINK_WINDOW_MS`) de elementos que se combinam, em files diferentes → multiplicador + uma palavra sobre a cabeça.
- **Pincer**: quantos files os corpos ocupam.
- **Cover/revive**: cair não sai do campo — corpo por `DOWN_GRACE_MS`, um parceiro a 1 file, 2 s parado de atirar para levantar. Sozinho e caído é wipe no beat em que acontece.
- `partyPowerScale = n^0.5` no dano, `1/n^0.5` na mira: **o grupo encurta a luta, não te deixa mais seguro por golpe recebido.** Essa é a versão honesta da afirmação e vale manter.

---

## 9. Progressão — o que o Mega Man Star Force *realmente* faz

Verificado contra manual americano (archive.org), TREZ e MMKB. **Não existe lista de tarefas de EP nem tela de alocação de pontos em Star Force**; a tela de 10 stats (com WND/SLIDE/CPY/GUT) é do Battle Network. O que existe:

- **Level não vem de XP de batalha.** MegaMan Level 1–100: **+1 por HPMem10, +2 por HPMem20, +3 por biblioteca de classe completa.** Progressão vem de **comprar** e de **completar coleção**.
- **O gate de capítulo são os irmãos.** Brother Band, 6 no máximo (3 antes de zerar), cada um com **um degrau mecânico**: Pegasus `Gauge+1`, Leo `Attack+1`, Dragon `MegaClass+1`, Zack `MegaClass+1`, Bud `+140 HP`.
- **Stats reais: HP, Attack (AT), Rapid (RA), Charge (CH), Gauge, slots Mega/Giga.** AT manda porque **o shot carregado faz 10×**. Dano de carta é fixo, multiplicado só por elemento/painel e AttackPower (×2/×3 em fraqueza).
- **Acertar de resposta paga uma carta aleatória (Bonus Card).** Você é pago por ler certo, na moeda do deck.
- **Busting Level** dá nota por luta: tempo de delete, 0 aback +1 / 4 aback −3, double delete +2, triple +4, **0–2 passos dados +1**, counters +1 cada. **>10 = rank S = drop melhor.**
- **Fontes de carta com odds publicados:** mystery wave (respawn por pulso, 1/64), Card Trader gacha (1,5% / 9 / 12 / 15,5 / 25 / 37%), Help Quests (**uma ativa por vez**, ~50 em 5 distritos), Cipher Mail, e **replay fantasma do boss → carta EX/SP cujo dano escala com o SEU registro**.
- **Só carta é tradeável.** Habilidade e equipamento nunca.
- O hub carrega a maior parte da *sensação* de progresso: scanning, pulsar em terminais, um Help Quest, minigames de navi-card, marcas na tela de título.

**Porto para o Chog, na ordem:** (1) **nota da luta que escala o drop** — o campo já sabe tempo, passos, dodges, counters e dano; (2) **counter-hit paga carta**; (3) **WAV compra stats** (HP/Attack/Rapid/Charge/Gauge/slots já existem como números no código — `fieldHp`, `waveAffinity`, `cleanSignal`, `gaugeScale`, `queueSlots`, `mega/gigaSlots`); (4) **parceiros NPCs como gate de capítulo**, cada um com um degrau; (5) **odds de drop publicados na UI**; (6) **uma quest ativa por vez**; (7) **trade só de cartas**, com escrow e a regra que o código já sabe: duas bodies da mesma wallet não trocam entre si.

**O que está morto no repositório e é exatamente onde esses números plugam:** `unlocks.laserCharges` (decorativo), item `scan` (seta uma flag que ninguém lê), títulos de first-clear (anunciados, nunca persistidos), e 5 dos 7 `GearMod` (`slots crit guard drain speed` — só `hp` e `gauge` funcionam). **Não crie um sistema novo: ligue esses cinco.**

---

## 10. Combate — o que One Step From Eden *realmente* faz

- **Não existe dash, esquiva, corrida nem bloqueio.** Os controles são mover, Spell 1, Spell 2, Weapon, Shuffle, Remove, Upgrade, Deck, Shop, Map. `InvulLength` no motor é janela **depois de apanhar**, não ação.
- **O verbo de escape é o Shuffle:** ejeta e recarrega a fila. **2,5 s inicial, +0,15 s por uso até 3 s**, e **corta seu escudo em 40%** enquanto roda. Fuga é paga em ofensa e guarda, não em cooldown — e piora dentro da mesma luta se você abusar.
- **I-frame é artefato comprável:** Pocket Sand (1 s ao shufflar), Ghost Costume (4 s no início), Phase Plates (0,75 s ao apanhar). Mobilidade também: Haste (velocidade ×2).
- Arena 4×8 com **cada lado preso na própria metade**; chefes anunciam **como jogador de cartas** (o slot de cast fica visível acima do sprite) e o perigo é geométrico ("evite os quatro painéis à frente, ou qualquer ponto da linha dela").
- Progressão em duas camadas: na run **1 de 3 magias** pós-luta e **1 de 3 artefatos** por level, upgrades sem teto; a camada permanente é **desbloqueio, não árvore de stats**.
- **Críticas consistentes (não copie):** sobrecarga cognitiva ("entre desviar, alinhar magias, posicionamento e as habilidades enfileiradas, foi demais"), sprites de poucos pixels ilegíveis no calor, "falta de variedade é o maior defeito", **lançou sem opção de dificuldade**, tutorial fino.

**Porto:** um verbo **Shuffle** no duelo (reembaralhar a mão atual, custo crescente, gastando a sala-segura) em vez de dash; i-frames e mobilidade como **gear**, ligando os `GearMod` mortos; e manter o teto de legibilidade — uma coisa por painel, um toque por ação, nenhum hotkey em cima de WASD.

---

## 11. O que matar e o que carregar do que existe

**Mata:** a cena de batalha em Phaser (`client/src/scenes/Battle.ts`) — é um segundo combate paralelo com seu próprio laser e sua própria grade, e é a causa de o laser ter "funcionado" por um caminho que ninguém joga. E o `world.fire()` legado (scoreGrid direto, sem sessão) pelo mesmo motivo: dois donos do mesmo dano.

**Carrega:** `shared/` inteiro de regras puras (`custom`, `draft`, `grid`, `field`, `duel`, `moves`, `party`) — é testado (506 testes) e é a única razão pela qual a UI e o servidor não divergem. E o gerador de mapa com **preço resolvido** (`nodeBudget` → `powerForCost`): subir a vida de um nó não pode tornar um fold impossível, só mais longo, drenando na taxa prometida.

**Depende de novo número:** o modelo de pacing (`loop.ts`) tem `hitRate` das bandas `0.34 / 0.18 / 0.08` **medidos num chão de 3 files**. Com `cols` dinâmico esse número está errado a favor do jogador, e todo orçamento de dungeon deriva dele. **Re-medir antes de ajustar qualquer dificuldade.**

---

## 12. Armadilhas que eu pisei nesta sessão

1. **`el.click()` não prova clicabilidade.** Ele dispara o handler não importa onde o elemento esteja nem o que esteja pintado por cima. Só um evento de mouse real no pixel do elemento (`Input.dispatchMouseEvent` + `document.elementFromPoint`) responde "o jogador consegue apertar isso?". Uma auditoria que usava `.click()` me deixou reportar "consertado" para um painel que estava fora do viewport.
2. **Painel animado engana teste.** Um painel que desliza por `transform` tem caixa de layout fora da tela durante a transição; medir nesse instante acusa 19 controles mortos que eram só não-postos. E **polling com `until` pode impedir a transição de completar** — esperar um tempo fixo funcionou onde o poll estourou timeout.
3. **Largura constante virou pressuposto em todo lugar.** Ao tirar o 3 literal, apareceram: `clamp(file, 0, 2)` no input do jogador (invisível em teste de servidor, letal em jogo), `% 3` no mapeamento visual, um array de 3 nomes indexado pela file (crasharia no file 4), e `coverage()` com 3 entradas.
4. **Multiplicador de dano por golpe é dupla contagem** com um golpe que marca mais files — e quebrou o invariante do orçamento. Os testes que já existiam pegaram; sem eles teria ido embora.
5. **Servidor em Node não hot-reload; cliente em vite sim.** Metade do par em código velho produz sintoma misterioso (campo ausente na view) que parece bug de renderização.
6. **Contar `grep` de um campo não é contar cartas.** Eu afirmei "50 de 63 cartas"; são **42 de 54**. Números de inventário saem rodando o módulo, não contando linhas.
