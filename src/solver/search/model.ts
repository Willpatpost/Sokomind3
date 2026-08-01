import type {
  Box,
} from "../../core/model.ts";
import type {
  CompiledSearchBoard,
} from "./compiled-board.ts";

/** Dynamic box data in the dense coordinate system used by search. */
export interface DenseBox {
  readonly id: string;
  readonly label: string;
  readonly cell: number;
}

/** Convert JSON-safe core boxes into deterministic dense search values. */
export function toDenseBoxes(
  board: CompiledSearchBoard,
  boxes: readonly Box[],
): readonly DenseBox[] {
  const denseBoxes = boxes.map((box) => {
    const cell = board.cellAt(box.position.row, box.position.column);
    if (cell < 0) {
      throw new RangeError(
        `Box ${JSON.stringify(box.id)} is not on a floor cell.`,
      );
    }
    return Object.freeze({
      id: box.id,
      label: box.label,
      cell,
    });
  });
  return Object.freeze(denseBoxes);
}

/**
 * Canonical box-only identity.
 *
 * Stable box ids are deliberately excluded: boxes carrying the same label are
 * interchangeable for both solving and assignment. Labels and cells are
 * length-delimited so the signature remains unambiguous.
 *
 * IMPORTANT: This function assumes `boxes` is already sorted by
 * label charCode then `cell` ascending (the order produced by
 * `sortedBoxes()` in engine.ts). All callers in the search loop pass boxes
 * that went through `movedBoxes()` -> `sortedBoxes()`, and the heuristic
 * cache receives boxes from search nodes which were also created that way.
 * If a future caller passes unsorted boxes, the signature will be wrong.
 */
export function canonicalBoxSignature(
  boxes: readonly DenseBox[],
): string {
  if (boxes.length === 0) return "";
  let result = "";
  let i = 0;
  while (i < boxes.length) {
    const label = boxes[i].label;
    if (result) result += "|";
    result += `${label.length}:${label}:${boxes[i].cell}`;
    i += 1;
    while (i < boxes.length && boxes[i].label === label) {
      result += `.${boxes[i].cell}`;
      i += 1;
    }
  }
  return result;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export class ZobristTable {
  readonly #boxTable: Uint32Array[];
  readonly #robotTable: Uint32Array;
  readonly #boxTable2: Uint32Array[];
  readonly #robotTable2: Uint32Array;
  readonly #labelToIndex: Map<string, number>;

  constructor(cellCount: number, labels: readonly string[]) {
    const rng = mulberry32(0xdeadbeef);
    this.#labelToIndex = new Map<string, number>();
    for (let i = 0; i < labels.length; i++) {
      this.#labelToIndex.set(labels[i], i);
    }
    const labelCount = labels.length;
    this.#boxTable = new Array(cellCount);
    this.#boxTable2 = new Array(cellCount);
    for (let c = 0; c < cellCount; c++) {
      this.#boxTable[c] = new Uint32Array(labelCount);
      this.#boxTable2[c] = new Uint32Array(labelCount);
      for (let l = 0; l < labelCount; l++) {
        this.#boxTable[c][l] = rng();
        this.#boxTable2[c][l] = rng();
      }
    }
    this.#robotTable = new Uint32Array(cellCount);
    this.#robotTable2 = new Uint32Array(cellCount);
    for (let c = 0; c < cellCount; c++) {
      this.#robotTable[c] = rng();
      this.#robotTable2[c] = rng();
    }
  }

  stateKey(canonicalRobotCell: number, boxes: readonly DenseBox[]): string {
    let h1 = this.#robotTable[canonicalRobotCell] ?? 0;
    let h2 = this.#robotTable2[canonicalRobotCell] ?? 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const labelIndex = this.#labelToIndex.get(box.label) ?? 0;
      const cellRow = this.#boxTable[box.cell];
      const cellRow2 = this.#boxTable2[box.cell];
      h1 = (h1 ^ (cellRow?.[labelIndex] ?? 0)) >>> 0;
      h2 = (h2 ^ (cellRow2?.[labelIndex] ?? 0)) >>> 0;
    }
    return `${h1}:${h2}`;
  }
}
