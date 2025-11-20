import {editor, type IPosition, type IRange} from "monaco-editor/esm/vs/editor/editor.api.js"

type ICodeEditor = editor.ICodeEditor;

const OPTION_FontSize = 52
const OPTION_LineHeight = 67

export type SelectorMenuTool = {
    name: string,
    innerHTML: string | Element | (() => string | Element),
    action: (() => Promise<void>) | (() => void)
}

export enum DefaultToolName {
    Copy = 'copy',
    Cut = 'cut',
    Paste = 'paste',
    SelectAll = 'selectAll',
    Undo = 'undo',
    Redo = 'redo',
    Close = 'close',
}

export type SelectorMenuToolConfig =
    (options: {
        editor: ICodeEditor,
        selectorMenu: HTMLDivElement,
        defaultTools: Map<DefaultToolName, SelectorMenuTool>,
        openMenu: () => void,
        closeMenu: () => void,
    }) => Iterable<SelectorMenuTool> | undefined


type Selector = HTMLDivElement & {
    bottomCursor: HTMLDivElement,
    textCursor: HTMLDivElement,
}

const updateSelectionStart = (selection: IRange, position: IPosition): IRange => {
    return {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn
    }
}

const updateSelectionEnd = (selection: IRange, position: IPosition): IRange => {
    return {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: position.column
    }
}

// 当触点移动到上下边缘时，尝试垂直滚动
const scrollTopExtremityFit = (editor: ICodeEditor, touch: Touch, lineHeight: number) => {
    const scrollTop = editor.getScrollTop()

    const scrollHeight = editor.getScrollHeight()
    const viewHeight = editor.getLayoutInfo().height
    const maxScrollTop = Math.max(0, scrollHeight - viewHeight)

    const canScrollUp = scrollTop > 0
    const canScrollDown = scrollTop < maxScrollTop

    const previousTarget = editor.getTargetAtClientPoint(touch.clientX, touch.clientY - lineHeight)
    const nextTarget = editor.getTargetAtClientPoint(touch.clientX, touch.clientY + lineHeight)
    if (previousTarget === null && nextTarget !== null && canScrollUp) {
        // 触发向上滚动
        const newScrollTop = Math.max(0, scrollTop - lineHeight)
        editor.setScrollTop(newScrollTop, 0)
    } else if (previousTarget !== null && nextTarget === null && canScrollDown) {
        // 触发向下滚动
        const newScrollTop = Math.min(maxScrollTop, scrollTop + lineHeight)
        editor.setScrollTop(newScrollTop, 0)
    }
}

// 当触点移动到左右边缘时，尝试水平滚动
const scrollLeftExtremityFit = (editor: ICodeEditor, touch: Touch, letterWidth: number) => {
    const scrollLeft = editor.getScrollLeft()

    const scrollWidth = editor.getScrollWidth()
    const viewWidth = editor.getLayoutInfo().width
    const maxScrollLeft = Math.max(0, scrollWidth - viewWidth)

    const canScrollLeft = scrollLeft > 0
    const canScrollRight = scrollLeft < maxScrollLeft

    const previousTarget = editor.getTargetAtClientPoint(touch.clientX - letterWidth, touch.clientY)
    const nextTarget = editor.getTargetAtClientPoint(touch.clientX + letterWidth, touch.clientY)
    if (previousTarget === null && nextTarget !== null && canScrollLeft) {
        // 触发向左滚动
        const newScrollLeft = Math.max(0, scrollLeft - letterWidth)
        editor.setScrollLeft(newScrollLeft, 0)
    } else if (previousTarget !== null && nextTarget === null && canScrollRight) {
        // 触发向右滚动
        const newScrollLeft = Math.min(maxScrollLeft, scrollLeft + letterWidth)
        editor.setScrollLeft(newScrollLeft, 0)
    }
}

const DEFAULT_SELECTION_SYNC_TIMEOUT = 300

export const editorTouchSelectionHelp = (
    editor: ICodeEditor,
    options?: {
        tools?: SelectorMenuToolConfig,
        selectionSyncTimeout?: number | undefined,
        toolActionErrorHandler?: (name: string, error: Error | unknown) => Promise<void> | void,
    }
) => {
    const {
        tools,
        selectionSyncTimeout = DEFAULT_SELECTION_SYNC_TIMEOUT,
        toolActionErrorHandler = (name: string, error: Error | unknown) => {
            console.error(`tool ${name} cause error: `, error)
        },
    } = options ?? {}

    if (!editor) {
        throw new Error("editor not existed")
    }

    const element = editor.getDomNode()
    if (!element || !(element instanceof HTMLElement)) {
        throw new Error("editor container element not existed or it is not a HTMLElement")
    }


    const editorOverlayGuard = element.querySelector('.overflow-guard')
    if (!editorOverlayGuard || !(editorOverlayGuard instanceof HTMLElement)) {
        throw new Error("no overlay guard or it is not a HTMLElement")
    }

    const margin = element.querySelector('.monaco-editor .margin')
    let leftMargin = 0
    if (margin && margin instanceof HTMLElement) {
        leftMargin = margin.offsetWidth
    }

    let selectionsShow = false
    let selections: HTMLDivElement | null = null
    let leftSelector: Selector | null = null
    let rightSelector: Selector | null = null
    const showSelections = () => {
        if (!selections) return
        if (selectionsShow) return
        selectionsShow = true
        selections.classList.add('show')
    }
    const hideSelections = () => {
        if (!selections) return
        if (!selectionsShow) return
        selectionsShow = false
        selections.classList.remove('show')
    }

    let selectorMenuShow = false
    let selectorMenu: HTMLDivElement | null = null
    const showSelectorMenu = () => {
        if (!selectorMenu) return
        if (selectorMenuShow) return
        selectorMenuShow = true
        selectorMenu.classList.add('show')
    }
    const hideSelectorMenu = () => {
        if (!selectorMenu) return
        if (!selectorMenuShow) return
        selectorMenuShow = false
        selectorMenu.classList.remove('show')
    }

    let resizeOb: ResizeObserver | null = new ResizeObserver(() => {
        hideSelections()
        hideSelectorMenu()

        const selection = editor.getSelection()
        if (selection) debounceSyncSelectionTransform(selection)
    })
    resizeOb.observe(element)

    editor.onDidDispose(() => {
        resizeOb?.disconnect()
        resizeOb = null

        selections?.remove()
        leftSelector?.remove()
        rightSelector?.remove()
        selectorMenu?.remove()

        selections = null
        leftSelector = null
        rightSelector = null
        selectorMenu = null
    })

    const selectAll = () => {
        editor.focus()
        const model = editor.getModel()
        if (model) {
            const fullRange = model.getFullModelRange()
            editor.setSelection(fullRange)
        }
    }

    const copy = async (): Promise<boolean> => {
        try {
            const selection = editor.getSelection()
            if (!selection) return false
            const selectedText = editor.getModel()?.getValueInRange(selection)
            if (!selectedText) return false
            await navigator.clipboard.writeText(selectedText)
            return true
        } catch (e) {
            await toolActionErrorHandler(`copy fail: ${e}`, e)
            return false
        }
    }

    const cut = async (): Promise<boolean> => {
        try {
            const selection = editor.getSelection()
            if (!selection) return false
            const selectedText = editor.getModel()?.getValueInRange(selection)
            if (!selectedText) return false
            await navigator.clipboard.writeText(selectedText)
            editor.executeEdits('cut', [{range: selection, text: ''}])
            return true
        } catch (e) {
            await toolActionErrorHandler('cut', e)
            return false
        }
    }

    const paste = async (): Promise<boolean> => {
        try {
            const selection = editor.getSelection()
            if (!selection) return false

            const text = await navigator.clipboard.readText()
            if (text.length === 0) return false

            editor.executeEdits('paste', [{range: selection, text: text}])
            return true
        } catch (e) {
            await toolActionErrorHandler('paste', e)
            return false
        }
    }

    const undo = () => {
        editor.trigger('keyboard', 'undo', null)
    }

    const redo = () => {
        editor.trigger('keyboard', 'redo', null)
    }

    const sameSelectorBottomTransform = "translateX(-50%) translateY(25%) rotate(45deg)"
    const leftSelectorBottomTransform = "translateX(-100%) rotate(90deg)"
    const rightSelectorBottomTransform = ""

    const syncSelectionTransform = (selection: IRange) => {
        if (!leftSelector || !rightSelector) return

        const startPosition: IPosition = {
            lineNumber: selection.startLineNumber,
            column: selection.startColumn
        }
        const endPosition: IPosition = {
            lineNumber: selection.endLineNumber,
            column: selection.endColumn
        }

        // Get the position of the start and end of the selection in client coordinates
        const scrollLeft = editor.getScrollLeft()
        const startCoords = editor.getScrolledVisiblePosition(startPosition)
        const endCoords = editor.getScrolledVisiblePosition(endPosition)

        if (!startCoords || !endCoords) return

        // Get the top position of the start and end lines
        const startTop = editor.getTopForPosition(startPosition.lineNumber, startPosition.column)
        const endTop = editor.getTopForPosition(endPosition.lineNumber, endPosition.column)

        // Calculate positions for the selectors based on line number top positions
        const leftSelectorX = startCoords.left + scrollLeft - leftMargin
        const leftSelectorY = startTop
        const rightSelectorX = endCoords.left + scrollLeft - leftMargin
        const rightSelectorY = endTop

        leftSelector.style.opacity = "1"
        rightSelector.style.opacity = "1"

        leftSelector.style.transform = `translateX(${leftSelectorX}px) translateY(${leftSelectorY}px)`
        rightSelector.style.transform = `translateX(${rightSelectorX}px) translateY(${rightSelectorY}px)`

        if (leftSelectorX === rightSelectorX && leftSelectorY === rightSelectorY) {
            leftSelector.bottomCursor.style.transform = sameSelectorBottomTransform
            rightSelector.bottomCursor.style.transform = sameSelectorBottomTransform
        } else {
            leftSelector.bottomCursor.style.transform = leftSelectorBottomTransform
            rightSelector.bottomCursor.style.transform = rightSelectorBottomTransform
        }
    }

    let lastSyncTime = 0
    let syncSelectorTimer: number | undefined = undefined

    const debounceSyncSelectionTransform = (selection: IRange) => {
        clearTimeout(syncSelectorTimer)
        if (!leftSelector || !rightSelector) return
        const currentSyncTime = Date.now()
        if (currentSyncTime - lastSyncTime < selectionSyncTimeout) {
            lastSyncTime = currentSyncTime
            leftSelector.style.opacity = "0"
            rightSelector.style.opacity = "0"
            syncSelectorTimer = window.setTimeout(() => {
                syncSelectionTransform(selection)
            }, selectionSyncTimeout)
            return
        } else {
            lastSyncTime = currentSyncTime
            syncSelectionTransform(selection)
        }
    }


    const toSelector = (element: HTMLDivElement): Selector => {
        element.classList.add('selector')

        const textCursor = document.createElement('div')
        textCursor.classList.add('text-cursor')
        element.appendChild(textCursor)

        const bottomCursor = document.createElement('div')
        bottomCursor.classList.add('bottom-cursor')
        element.appendChild(bottomCursor)

        const selector = element as Selector
        selector.textCursor = textCursor
        selector.bottomCursor = bottomCursor

        return selector
    }

    const initSelections = () => {
        selections = document.createElement('div')
        selections.classList.add('monaco-editor-touch-selections')

        const leftSelectorEl = document.createElement('div')
        leftSelectorEl.classList.add('left')
        leftSelector = toSelector(leftSelectorEl)
        selections.appendChild(leftSelectorEl)

        const rightSelectorEl = document.createElement('div')
        rightSelectorEl.classList.add('right')
        rightSelector = toSelector(rightSelectorEl)
        selections.appendChild(rightSelectorEl)

        let lineHeight = editor.getOption(OPTION_LineHeight)
        let fontSize = editor.getOption(OPTION_FontSize)

        const syncSelectorStyle = (lineHeight: number) => {
            if (leftSelector) {
                leftSelector.textCursor.style.height = `${lineHeight}px`
                leftSelector.bottomCursor.style.marginTop = `${lineHeight}px`
            }
            if (rightSelector) {
                rightSelector.textCursor.style.height = `${lineHeight}px`
                rightSelector.bottomCursor.style.marginTop = `${lineHeight}px`
            }
        }
        syncSelectorStyle(lineHeight)
        editor.onDidChangeConfiguration((e) => {
            if (e.hasChanged(OPTION_LineHeight)) {
                lineHeight = editor.getOption(OPTION_LineHeight)
                syncSelectorStyle(lineHeight)
            }
            if (e.hasChanged(OPTION_FontSize)) {
                fontSize = editor.getOption(OPTION_FontSize)
            }
        })

        editorOverlayGuard.append(selections)
        editor.onDidScrollChange((e) => {
            if (selections) {
                selections.style.top = `-${e.scrollTop}px`
                selections.style.left = `-${e.scrollLeft}px`
            }
        })

        const setupSelectorTouchEvent = (
            selector: Selector,
            updateSelection: (selection: IRange, position: IPosition) => IRange
        ) => {
            const showSelectionMenuByTouch = (touch: Touch) => {
                const initialSelection = editor.getSelection()
                if (!initialSelection) return
                const selectionIsEmpty = initialSelection.isEmpty()

                if (!selectionIsEmpty && touch && selectorMenu && leftSelector && rightSelector) {
                    showSelectorMenu()

                    const leftRect = leftSelector.getBoundingClientRect()
                    const rightRect = rightSelector.getBoundingClientRect()

                    // 计算 touch 点到 left selector 的距离
                    const leftDistancePow2 = Math.pow(touch.clientX - (leftRect.left + leftRect.width / 2), 2) +
                        Math.pow(touch.clientY - (leftRect.top + leftRect.height / 2), 2)

                    // 计算 touch 点到 right selector 的距离
                    const rightDistancePow2 = Math.pow(touch.clientX - (rightRect.left + rightRect.width / 2), 2) +
                        Math.pow(touch.clientY - (rightRect.top + rightRect.height / 2), 2)

                    // 选择距离更近的 selector
                    const closerRect = leftDistancePow2 <= rightDistancePow2 ? leftRect : rightRect;

                    const elementRect = element.getBoundingClientRect()
                    const menuRect = selectorMenu.getBoundingClientRect()

                    let x = closerRect.left - elementRect.left - menuRect.width / 2
                    if (x + menuRect.width > elementRect.width) x = elementRect.width - menuRect.width
                    if (x < 0) x = 0

                    let y = closerRect.top - elementRect.top - menuRect.height
                    if (y + menuRect.height > elementRect.height) y = elementRect.height - menuRect.height
                    if (y < 0) y = closerRect.top - elementRect.top + lineHeight

                    // 防止超出视野范围
                    if (window.visualViewport) {
                        if (x + menuRect.width > window.visualViewport.width) x = window.visualViewport.width - menuRect.width
                        if (y + menuRect.height > window.visualViewport.height) y = window.visualViewport.height - menuRect.height
                    } else {
                        if (x + menuRect.width > document.body.clientWidth) x = document.body.clientWidth - menuRect.width
                        if (y + menuRect.height > document.body.clientHeight) y = document.body.clientHeight - menuRect.height
                    }

                    selectorMenu.style.transform = `translateX(${x + elementRect.left}px) translateY(${y + elementRect.top}px)`
                }
            }

            selector.addEventListener('touchstart', (event: TouchEvent) => {
                const initialSelection = editor.getSelection()
                if (!initialSelection) return

                let touch = event.changedTouches[0] ?? event.touches[0]

                const selectionIsEmpty = initialSelection.isEmpty()

                let revealTimer = setInterval(() => {
                    scrollTopExtremityFit(editor, touch, lineHeight)
                    scrollLeftExtremityFit(editor, touch, fontSize)
                    const target = editor.getTargetAtClientPoint(touch.clientX, touch.clientY - lineHeight / 2)
                    if (target && target.position) {
                        if (selectionIsEmpty) {
                            editor.setPosition(target.position)
                        } else {
                            editor.setSelection(updateSelection(initialSelection, target.position))
                        }
                    }
                }, 100)

                const handleMove = (event: TouchEvent) => {
                    event.preventDefault()
                    touch = event.changedTouches[0] ?? event.touches[0]
                }

                const handleEnd = (event: TouchEvent) => {
                    event.preventDefault()
                    touch = event.changedTouches[0] ?? event.touches[0]
                    handleMove(event)
                    clearTimeout(revealTimer)

                    if (selectorMenu && editor.getSelection() !== null) {
                        showSelectionMenuByTouch(touch)
                    }

                    document.removeEventListener('touchmove', handleMove)
                    document.removeEventListener('touchend', handleEnd)
                    document.removeEventListener('touchcancel', handleEnd)
                }

                document.addEventListener('touchmove', handleMove, {passive: false})
                document.addEventListener('touchend', handleEnd)
                document.addEventListener('touchcancel', handleEnd)
            }, {passive: true})
        }

        setupSelectorTouchEvent(leftSelector, updateSelectionStart)
        setupSelectorTouchEvent(rightSelector, updateSelectionEnd)

        const setupTextCursorSelectWord = (textSelector: HTMLDivElement) => {
            let lastTouchTime = 0
            textSelector.addEventListener('touchstart', () => {
                const selection = editor.getSelection()
                if (!selection) return
                if (selection?.startColumn !== selection.endColumn || selection.startLineNumber !== selection.endLineNumber) return

                const model = editor.getModel()
                if (!model) return

                const currentTouchTime = Date.now()
                if (currentTouchTime - lastTouchTime > 200) {
                    lastTouchTime = currentTouchTime
                    return
                }

                const word = model.getWordAtPosition(selection.getStartPosition())
                if (word) {
                    editor.setSelection({
                        startLineNumber: selection.startLineNumber,
                        startColumn: word.startColumn,
                        endLineNumber: selection.endLineNumber,
                        endColumn: word.endColumn,
                    })
                }
            }, {passive: true})
        }

        setupTextCursorSelectWord(leftSelector.textCursor)
        setupTextCursorSelectWord(rightSelector.textCursor)

        const selection = editor.getSelection()
        if (selection) debounceSyncSelectionTransform(selection)
    }

    editor.onDidChangeCursorSelection((e) => {
        hideSelectorMenu()
        setTimeout(() => {
            debounceSyncSelectionTransform(e.selection)
        }, 0)
    })

    initSelections()

    const getMenuTools = (
        selectorMenu: HTMLDivElement
    ): Iterable<SelectorMenuTool> => {
        const defaultTools: Map<DefaultToolName, SelectorMenuTool> = new Map([
            [DefaultToolName.Copy, {
                name: 'copy',
                innerHTML: `
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,
                action: async () => {
                    const result = await copy()
                    if (result) hideSelectorMenu()
                }
            }],
            [DefaultToolName.Cut, {
                name: 'cut',
                innerHTML: `
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M7 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
    <path d="M17 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
    <path d="M9.15 14.85l8.85 -10.85" />
    <path d="M6 4l8.85 10.85" />
</svg>`,
                action: async () => {
                    const result = await cut()
                    if (result) hideSelectorMenu()
                }
            }],
            [DefaultToolName.Paste, {
                name: 'paste',
                innerHTML: `
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h3m9 -9v-5a2 2 0 0 0 -2 -2h-2" />
    <path d="M13 17v-1a1 1 0 0 1 1 -1h1m3 0h1a1 1 0 0 1 1 1v1m0 3v1a1 1 0 0 1 -1 1h-1m-3 0h-1a1 1 0 0 1 -1 -1v-1" />
    <path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z" />
</svg>`,
                action: async () => {
                    const result = await paste()
                    if (result) hideSelectorMenu()
                }
            }],
            [DefaultToolName.Undo, {
                name: 'undo',
                innerHTML: `
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M9 14l-4 -4l4 -4"/>
    <path d="M5 10h11a4 4 0 1 1 0 8h-1"/>
</svg>`,
                action: () => {
                    undo()
                    showSelectorMenu()
                }
            }],
            [DefaultToolName.Redo, {
                name: 'redo',
                innerHTML: `
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M15 14l4 -4l-4 -4"/>
    <path d="M19 10h-11a4 4 0 1 0 0 8h1"/>
</svg>`,
                action: () => {
                    redo()
                    showSelectorMenu()
                }
            }],
            [DefaultToolName.SelectAll, {
                name: 'select all',
                innerHTML: `
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 17 16 l 4 -4 l -4 -4 M 7 16 l -4 -4 l 4 -4 M 22 6 v 12 M 5 12 h 14"/>
</svg>`,
                action: () => {
                    selectAll()
                    showSelectorMenu()
                }
            }],
            [DefaultToolName.Close, {
                name: 'close',
                innerHTML: `
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M18 6l-12 12" />
    <path d="M6 6l12 12" />
</svg>`,
                action: () => {
                    hideSelectorMenu()
                    return true
                }
            }]
        ])

        if (tools === undefined) {
            return defaultTools.values()
        }

        if (typeof tools === 'function') {
            const result = tools({
                editor,
                selectorMenu,
                defaultTools,
                openMenu: showSelectorMenu,
                closeMenu: hideSelectorMenu,
            })
            if (result === undefined) {
                return defaultTools.values()
            }
            return result
        }

        return defaultTools.values()
    }

    const initSelectorMenu = () => {
        selectorMenu = document.createElement('div')
        selectorMenu.classList.add('monaco-editor-touch-selector-menu')

        for (const menuTool of getMenuTools(selectorMenu)) {
            const menuItemElement = document.createElement('div')
            menuItemElement.classList.add('menu-item')

            if (typeof menuTool.innerHTML === 'function') {
                const result = menuTool.innerHTML()
                if (typeof result === 'string') menuItemElement.innerHTML = result
                else menuItemElement.appendChild(result)
            } else {
                if (typeof menuTool.innerHTML === 'string') menuItemElement.innerHTML = menuTool.innerHTML
                else menuItemElement.appendChild(menuTool.innerHTML)
            }

            menuItemElement.addEventListener('touchend', async () => {
                try {
                    await menuTool.action()
                } catch (e) {
                    await toolActionErrorHandler(menuTool.name, e)
                }
            })

            selectorMenu.appendChild(menuItemElement)
        }

        selectorMenu.addEventListener('touchstart', (event) => {
            event.preventDefault()
        }, {passive: false})

        selectorMenu.addEventListener('touchmove', (event) => {
            event.preventDefault()
        }, {passive: false})

        selectorMenu.addEventListener('touchend', (event) => {
            event.preventDefault()
        }, {passive: false})

        document.documentElement.append(selectorMenu)
    }
    initSelectorMenu()

    element.addEventListener('touchstart', () => {
        showSelections()
    }, {passive: true})

    editor.onDidBlurEditorWidget(() => {
        hideSelections()
        hideSelectorMenu()
    })

    element.addEventListener('click', (event) => {
        event.stopPropagation()
    })
}