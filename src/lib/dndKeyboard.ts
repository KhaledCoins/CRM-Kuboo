import { KeyboardCode, type KeyboardCoordinateGetter } from "@dnd-kit/core";

// ─── Coordenadas de teclado para os quadros kanban (Pipeline/Tarefas) ──────
// Os quadros usam @dnd-kit/core "puro" (useDraggable + useDroppable), sem
// @dnd-kit/sortable — cada coluna é UM droppable, não há reordenação de
// cartões dentro da coluna. O coordinateGetter padrão do dnd-kit move o
// ponto de arraste em passos fixos de pixel, o que não faz sentido pra
// colunas largas lado a lado. Aqui, seta esquerda/direita pula pro centro
// da coluna vizinha (na ordem passada em `columnOrder`); cima/baixo não
// fazem nada, já que não há ordem a mudar dentro da coluna.
export function criarColumnKeyboardCoordinateGetter(columnOrder: string[]): KeyboardCoordinateGetter {
  return (event, { context, currentCoordinates }) => {
    if (event.code !== KeyboardCode.Left && event.code !== KeyboardCode.Right) return undefined;

    const { droppableRects } = context;

    // Descobre em qual coluna o item está agora: a droppable cujo centro X
    // está mais perto do ponto de arraste atual.
    let colunaAtual = -1;
    let melhorDist = Infinity;
    for (const [id, rect] of droppableRects) {
      const idx = columnOrder.indexOf(String(id));
      if (idx === -1) continue;
      const centroX = rect.left + rect.width / 2;
      const dist = Math.abs(centroX - currentCoordinates.x);
      if (dist < melhorDist) { melhorDist = dist; colunaAtual = idx; }
    }
    if (colunaAtual === -1) return undefined;

    const novoIdx = colunaAtual + (event.code === KeyboardCode.Right ? 1 : -1);
    if (novoIdx < 0 || novoIdx >= columnOrder.length) return undefined;

    const novoId = columnOrder[novoIdx];
    const novoRect = droppableRects.get(novoId);
    if (!novoRect) return undefined;

    event.preventDefault();
    return {
      x: novoRect.left + novoRect.width / 2,
      y: currentCoordinates.y,
    };
  };
}
