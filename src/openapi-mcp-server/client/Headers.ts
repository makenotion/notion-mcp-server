export class Headers {
    private headers: Map<string, string[]> = new Map();

    constructor(init?: Record<string, string>) {
        if (init) {
            Object.entries(init).forEach(([key, value]) => {
                this.append(key, value);
            });
        }
    }

    public append(name: string, value: string): void {
        const key = name.toLowerCase();

        if (!this.headers.has(key)) {
            this.headers.set(key, []);
        }

        this.headers.get(key)!.push(value);
    }

    public get(name: string): string | null {
        const key = name.toLowerCase();

        if (!this.headers.has(key)) {
            return null;
        }

        return this.headers.get(key)!.join(', ');
    }
}
