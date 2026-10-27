export function formatColumnGrid(items: string[], width: number): string[] {
    if (items.length === 0) return [];

    const colWidth = Math.max(...items.map((item) => item.length)) + 2;
    const numCols = Math.max(1, Math.floor(width / colWidth));
    const numRows = Math.ceil(items.length / numCols);

    const lines: string[] = [];
    for (let row = 0; row < numRows; row++) {
        let line = "";
        for (let col = 0; col < numCols; col++) {
            const index = col * numRows + row;
            if (index >= items.length) break;
            line += items[index].padEnd(colWidth);
        }
        lines.push(line.trimEnd());
    }
    return lines;
}
