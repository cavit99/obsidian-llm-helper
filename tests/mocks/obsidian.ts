export type EditorPosition = { line: number; ch: number };
export class Editor {}

export class App {}

export class Plugin {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(public app?: any) {}
}

export class PluginSettingTab {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(public app: App, public plugin: any) {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  display(): void {}
}

export class Modal {
  app: App;
  contentEl: {
    empty: () => void;
    createEl: (_tag: string, _opts?: any) => any;
    createDiv: (_opts?: any) => any;
  };
  constructor(app: App) {
    this.app = app;
    this.contentEl = {
      empty: () => {},
      createEl: () => ({ addClass: () => {}, style: {}, createSpan: () => {}, createDiv: () => {}, textContent: "" }),
      createDiv: () => ({ createSpan: () => {}, addClass: () => {}, style: {}, toggleClass: () => {}, textContent: "" })
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  open(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  close(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onOpen(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onClose(): void {}
}

export class Setting {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(public containerEl: HTMLElement) {}
  setName(_: string): this {
    return this;
  }
  setDesc(_: string): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  addText(cb: (input: any) => void): this {
    const api = {
      inputEl: {
        style: {},
        addClass: () => {},
        addEventListener: () => {},
        type: "text"
      },
      setPlaceholder: () => api,
      setValue: () => api,
      onChange: () => api
    };
    cb(api);
    return this;
  }
}

export class Notice {
  static messages: string[] = [];
  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export function requestUrl(): never {
  throw new Error("requestUrl not implemented in tests");
}
