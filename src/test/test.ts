import * as monaco from 'monaco-editor';
import {DefaultToolName, editorTouchSelectionHelp} from '../index.ts';

const element = document.getElementById('container')!


const editor = monaco.editor.create(element, {
    value: '',
});

editorTouchSelectionHelp(editor, {
    tools: ({defaultTools}) => {
        const copyTool = defaultTools.get(DefaultToolName.Copy)
        if (copyTool) {
            copyTool.action = () => {
                // TODO: change default copy action
            }
        }
        return defaultTools.values()
    }
})