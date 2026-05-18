"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveLocally = saveLocally;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const config_js_1 = require("./config.js");
async function saveLocally(filename, buffer) {
    const dir = node_path_1.default.resolve(process.cwd(), config_js_1.config.localStorageDir);
    await promises_1.default.mkdir(dir, { recursive: true });
    const diskName = `${Date.now()}_${filename}`;
    const filePath = node_path_1.default.join(dir, diskName);
    await promises_1.default.writeFile(filePath, buffer);
    const publicPath = `/local-recordings/${encodeURIComponent(diskName)}`;
    return {
        id: diskName,
        webViewLink: `${config_js_1.config.publicBaseUrl}${publicPath}`,
        webContentLink: `${config_js_1.config.publicBaseUrl}${publicPath}`,
        filePath,
    };
}
//# sourceMappingURL=storage.js.map