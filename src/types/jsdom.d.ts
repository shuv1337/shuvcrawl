declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: any);
    window: {
      document: Document;
    };
  }
}
