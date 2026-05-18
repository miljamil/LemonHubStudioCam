declare module 'better-sqlite3' {
  class Database {
    constructor(filename: string);
    pragma(statement: string): unknown;
    exec(sql: string): unknown;
    prepare(sql: string): {
      run: (...params: unknown[]) => unknown;
      all: (...params: unknown[]) => unknown[];
    };
  }

  export default Database;
}
