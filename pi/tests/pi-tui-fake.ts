// pi-tui is supplied by pi at runtime and is not installed in this repo.
// One shared fake: bun keeps the first mock.module() factory for a specifier
// for the whole run, so per-file mocks of pi-tui would shadow each other.
export class FakeContainer {
	children: any[] = [];
	addChild(c: any) {
		this.children.push(c);
	}
	clear() {
		this.children = [];
	}
}

export class FakeBox extends FakeContainer {
	bg = "";
	setBgFn(fn: (s: string) => string) {
		this.bg = fn("");
	}
	setPaddingX() {}
}

export class FakeText {
	constructor(public text: string) {}
}

export const piTuiFake = {
	Box: FakeBox,
	Container: FakeContainer,
	Text: FakeText,
	truncateToWidth: (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}\x1b[0m…\x1b[0m` : s),
	colorToRgb: (c: any) => c,
	mixColors: (a: any, b: any, t: number) => ({ kind: "rgb", r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }),
};
