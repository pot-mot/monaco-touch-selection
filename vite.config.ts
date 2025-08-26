import {defineConfig} from 'vite'
import {resolve} from 'path';
import dts from 'vite-plugin-dts';
import {cpSync} from 'fs';

export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'monaco-touch-selection',
            formats: ['es', 'umd'],
            fileName: 'index'
        },
    },
    plugins: [
        dts({
            exclude: ['src/test/*.ts']
        }),
        {
            name: 'copy-css',
            closeBundle() {
                // 构建完成后将样式文件复制到 dist 目录
                cpSync(
                    resolve(__dirname, 'src/style.css'),
                    resolve(__dirname, 'dist/style.css')
                );
            }
        }
    ],
})
