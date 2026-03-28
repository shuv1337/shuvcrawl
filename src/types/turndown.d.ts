declare module 'turndown' {
  export default class TurndownService {
    constructor(options?: any);
    use(plugin: any): void;
    turndown(html: string): string;
  }
}
