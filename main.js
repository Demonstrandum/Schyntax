// TODO:
// - [ ] rewrite (TS) with basic type safety for enum types especially.
// - [ ] add more rules (attr) based on node content.
// - [ ] create list with protonode on '(' key. autosplit like with ' ' key.
// - [ ] backspace on non-empty node should merge text conetent of adjacent literal.
// - [ ] only allow one protonode to exist at the time.
// - [ ] add keyboard shortcut to create node n-levels deep into adjacent nested list (emacs style).
// - [ ] delete nodes when backspace in empty (proto)node refocus logic.
// - [ ] delete node shortcut.
// - [ ] create array of available IDs when nodes get delated to reclaim them.
//       once IDs become too sparse, retag/reID the whole tree.

const isLiteral = (tree) => {
    switch (tree.type) {
    case 'symbol':
    case 'numeric':
    case 'proto':
        return true;
    case 'list':
        return false;
    default:
        throw `invalid type '${tree.type}'`;
    }
};

const syntaxTreeToText = (tree) => {
    const indent = tree.dropped ? '\n' + '  '.repeat(1) : '';
    switch (tree.type) {
    case 'list':
        return indent + '(' + tree.children.map(syntaxTreeToText).join(' ') + ')';
    case 'symbol':
    case 'numeric':
        return indent + tree.value;
    case 'proto':
        return '';
    default:
        throw `invalid tree type '${tree.type}'`;
    }
};

const attrLabels = {
    assignee: '=',
    boundVariable: '↓',
    keyword: '*',
};

const createSyntaxElement = (tree) => {
    const elem = document.createElement('fieldset');
    elem.id = `syntax-id-${tree.id}`;
    elem.classList.add('syntax');
    elem.classList.add(`syntax-type-${tree.type}`);
    if (isLiteral(tree))
        elem.classList.add('syntax-literal');
    for (const attr of tree.attr) {
        elem.classList.add(`syntax-attr-${attr}`);
        const label = attrLabels[attr];
        if (label) {
            const labelElem = document.createElement('legend');
            labelElem.innerText = label;
            elem.appendChild(labelElem);
        }
    }
    if (tree.dropped)
        elem.classList.add('syntax-dropped');

    return elem;
};

/* current node editing state */
const editingState = {
    focused: false,
    focusedId: 0,
    cursorOffset: 0,
};

const textRange = document.createRange();
const textSelection = window.getSelection();

const breakRule = document.createElement('br');

const renderHtml = (tree) => {
    const elem = createSyntaxElement(tree);

    switch (tree.type) {
    case 'list':
        for (const child of tree.children) {
            const node = renderHtml(child);
            if (child.dropped)
                elem.appendChild(breakRule);
            elem.appendChild(node);
        }
        break;
    /* editable literal types */
    case 'symbol':
    case 'numeric':
    case 'proto':
        const text = document.createElement('span');
        text.innerText = tree.value;
        text.setAttribute('contenteditable', true);
        elem.appendChild(text);

        /* what to do on value update */
        elem.addEventListener('input', treeUpdate(e => {
            console.log(e)
             /* update focused node */
            editingState.focused = true;
            editingState.focusedId = tree.id;
            editingState.cursorOffset = textSelection.focusOffset;
            /* special non-literal characters */
            if (e.data === ' ') {
                /* a space means we're adding another element to the parent */
                /* create new tree {proto,}node and set its focus */
                const lNode = tree.value.substr(0, editingState.cursorOffset - 1);
                const rNode = tree.value.substr(editingState.cursorOffset - 1);
                tree.value = lNode;
                const proto = insertSiblingAfter(tree, { value: rNode });
                /* update metainfo for both new nodes */
                relabelTree(tree);
                relabelTree(proto);
                /* set new focus to start of new right node */
                editingState.focused = true;
                editingState.focusedId = proto.id;
                editingState.cursorOffset = 0;
                /* refresh html for container of both nodes */
                return { refresh: tree.parent, elem: elem.parentElement };
            }
            /* update text content */
            tree.value = e.target.textContent;
            relabelTree(tree);
            /* refresh html after edit */
            return { refresh: tree, elem: elem  };
        }));

        /* handle special non-input keys */
        elem.addEventListener('keydown', treeUpdate(e => {
            console.log(e);
            /* delete node empty and backspace is pressed */
            if (tree.value.length === 0 && (e.key === 'Delete' || e.key === 'Backspace')) {
                /* refocus on adjacent node:
                 *  - move to left node if Backspace was pressed
                 *  - move to right node if Delete was pressed
                 *  - move only possible way if no other node is present
                 *  - delete containing list no other nodes are contained,
                 *    then repeat movment logic for outer list.
                 */
                const deleteNodeClimb = (node, domNode) => {
                    /* no parent means all the code is gone, so refocusing is impossible. */
                    if (node.parent === undefined)
                        return { refocus: false, deleteNode: node, elem: domNode };

                    if (node.parent.children.length === 1) {
                        /* delete containing node */
                        return deleteNodeClimb(node.parent, domNode.parentElement);
                    }

                    editingState.focused = true;
                    /* cursor refocus logic */
                    let jumpLeft = undefined;
                    if      (isLastChild(node))     jumpLeft = true;
                    else if (isFirstChild(node))    jumpLeft = false;
                    else if (e.key === 'Backspace') jumpLeft = true;
                    else if (e.key === 'Delete')    jumpLeft = false;

                    let focusedNode = null;
                    /* move into adjacent nodes */
                    if (jumpLeft) focusedNode = childBefore(node);
                    else          focusedNode = childAfter(node);

                    /* decend until we are find a literal node to edit */
                    while (focusedNode.type === 'list') {
                        focusedNode = focusedNode.children.at(jumpLeft ? -1 : 0);
                    }

                    editingState.focusedId = focusedNode.id;
                    editingState.cursorOffset = jumpLeft ? focusedNode.value.length : 0;

                    /* remove from syntax tree */
                    return { deleteNode: node, elem: domNode };
                };
                /* signal deleting node in dom tree */
                const deleteParams = deleteNodeClimb(tree, elem);
                return { refocus: true, ...deleteParams };
            }

            /* travel between sibling nodes with arrow keys */
            editingState.cursorOffset = textSelection.focusOffset;

            let focusNode = null;
            let cursorPos = null;

            /* don't do anything unless on textbox boundary */
            const onBoundary =
                editingState.cursorOffset === 0                 && e.key === 'ArrowLeft'
             || editingState.cursorOffset === tree.value.length && e.key === 'ArrowRight';

            if (!onBoundary)
                return;

            if (e.key === 'ArrowLeft')  {
                cursorPos = -1;
                if (tree.siblingIndex !== 0) {
                    /* move within the list container */
                    focusNode = tree.parent.children[tree.siblingIndex - 1];
                } else {
                    /* at edge of container, move out */
                    let parentNode = tree.parent;
                    while (parentNode && parentNode.siblingIndex === 0) {
                        parentNode = parentNode.parent;
                    }
                    if (parentNode) focusNode = parentNode.parent.children[parentNode.siblingIndex - 1];
                }
            } else if (e.key === 'ArrowRight') {
                cursorPos = 0;
                if (tree.siblingIndex !== tree.parent.children.length - 1) {
                    /* move within the list container */
                    focusNode = tree.parent.children[tree.siblingIndex + 1];
                } else {
                    /* at edge of container, move out */
                    let parentNode = tree.parent;
                    while (parentNode && parentNode.siblingIndex === parentNode.parent.children.length - 1) {
                        parentNode = parentNode.parent;
                    }
                    if (parentNode) focusNode = parentNode.parent.children[parentNode.siblingIndex + 1];
                }
            }

            if (focusNode === null) return;

            /* handle going in to non-literal nodes */
            while (focusNode.type === 'list') {
                focusNode = focusNode.children.at(cursorPos);
            }
            editingState.focused = true;
            editingState.focusedId = focusNode.id;
            editingState.cursorOffset = focusNode.value.length * -cursorPos;
            return { refocus: true };
        }));

        break;
    default:
        throw `invalid tree type '${tree.type}'`;
    }

    if (editingState.focused && tree.id === editingState.focusedId) {
        let text = getContentNode(elem);

        if (text) {
            /* set cursor position to previous one to maintain editing state */
            text.addEventListener('DOMNodeInsertedIntoDocument', e => {
                setCursorFocus(text);
            });
        }
    }

    return elem;
};

const isLastChild  = (child) => child.siblingIndex === child.parent.children.length - 1;
const isFirstChild = (child) => child.siblingIndex === 0;

const childAfter  = (sibling, offset=1) => sibling.parent.children[sibling.siblingIndex + offset];
const childBefore = (sibling, offset=1) => childAfter(sibling, -offset);

/* find the node's contenteditable child */
const getContentNode = (node) => {
    let content = null;
    for (const childNode of node.children) {
        if (childNode.getAttribute('contenteditable') == 'true') {
            content = childNode;
        }
    }
    return content;
}

const setCursorFocus = (text=null) => {
    if (text === null) {
        const nodeId = `syntax-id-${editingState.focusedId}`;
        text = document.getElementById(nodeId);
        text = getContentNode(text);
    }
    text.focus();
    textRange.setStart(text.childNodes[0] || text, editingState.cursorOffset)
    textRange.collapse(true)
    textSelection.removeAllRanges();
    textSelection.addRange(textRange);
};

const reindexChildren = (parent) => {
    for (let i = 0; i < parent.children.length; ++i) {
        parent.children[i].siblingIndex = i;
    }
    return parent;
};

const insertSiblingAfter = (sibling, node) => {
    /* new id */
    node.id = lastId + 1;
    lastId += 1;
    /* normal tags (TODO: make tagger function based on text) */
    node.attr = [];
    node.type = 'symbol';
    /* tag with parent information */
    node.parentId = sibling.parentId;
    node.parent   = sibling.parent;
    /* insert */
    sibling.parent.children.splice(sibling.siblingIndex + 1, 0, node);

    reindexChildren(sibling.parent);
    return node;
};

const deleteChild = (child) => {
    child.parent.children.splice(child.siblingIndex, 1);
    reindexChildren(child.parent);
    return child;
};

/* give a unique id tag to each branch & leaf of the tree. */
const retagTree = (tree, id=0) => {
    tree.id = id;

    let deepestId = id;

    if (tree.children) {
        for (let i = 0; i < tree.children.length; ++i) {
            const { lastId, taggedTree } = retagTree(tree.children[i], deepestId + 1);
            deepestId = lastId;
            /* tag with parent information */
            taggedTree.parentId = id;
            taggedTree.parent = tree;
            taggedTree.siblingIndex = i;
            /* update child */
            tree.children[i] = taggedTree;
        }
    }

    return { lastId: deepestId, taggedTree: tree };
};

const imbueAttr = (tree, attr) => {
    let changed = false;
    if (Array.isArray(attr)) {
        for (const a of attr) {
            changed = imbueAttr(tree, a) || changed;
        }
        return changed;
    }
    if (changed = !tree.attr.includes(attr))
        tree.attr.push(attr);
    return changed;
};

const depriveAttr = (tree, attr) => {
    let changed = false;
    if (Array.isArray(attr)) {
        for (const a of attr) {
            changed = depriveAttr(tree, a) || changed;
        }
        return changed;
    }
    if (changed = tree.attr.includes(attr))
        tree.attr.splice(tree.attr.indexOf(attr), 1);
    return changed;
}

/* ID -> TreeNode map for nodes that need to be rerendered */
let dirtyNodes = {};
const labelDirty = tree => {
    console.log('dirtying', tree);
    dirtyNodes[tree.id] = tree;
}

const BUILTIN_SYMBOLS = new Set(['*', '**', '/', '+', '-', '^', '!', '|', '&']);
const DEFINITION_SYMBOLS = new Set(['define', 'define-syntax']);

const relabelTree = (tree) => {
    console.log('relabelling', tree);
    /* reset attributes */
    const oldAttr = [...tree.attr];
    tree.attr = [];

    if (tree.type == 'list') {
        if (tree.parent && tree.parent.attr.includes('definition') && tree.siblingIndex == 1)
            imbueAttr(tree, 'assignee');
        for (const child of tree.children) {
            relabelTree(child);
        }
        return tree;
    }
    if (!isLiteral(tree)) throw `unknown type ${tree.type}.`;
    /* default literal is symbol */
    tree.type = 'symbol';

    if (BUILTIN_SYMBOLS.has(tree.value))
        imbueAttr(tree, 'builtin');

    let defnParent = null;
    if (DEFINITION_SYMBOLS.has(tree.value)) {
        imbueAttr(tree, ['keyword', 'definition'])
        if (tree.parent) {
            imbueAttr(tree.parent, 'definition');
            defnParent = tree.parent;
        }
    } else if (oldAttr.includes('definition')) {
        console.log('was defn');
        if (tree.parent) {
            depriveAttr(tree.parent, 'definition');
            defnParent = tree.parent;
        }
    }
    if (defnParent) {
        if (tree.parent.children.length >= 2) {
            const assignee = tree.parent.children[1];
            relabelTree(assignee);
            labelDirty(assignee);
        }
    }

    if (!isNaN(parseFloat(tree.value)))
        tree.type = 'numeric';

    if (tree.value.length === 0)
        tree.type = 'proto';

    if (tree.parent.attr.includes('assignee')) {
        // assigning to function call
        if (tree.siblingIndex == 0) imbueAttr(tree, 'assignee');
        else imbueAttr(tree, 'boundVariable');
    }

    return tree;
};

const reassignTree = (oldTree, newTree) => {
    oldTree.parent.children[oldTree.siblingIndex] = newTree;
};

const editorElem = document.getElementById('editor');
const textElem = document.getElementById('textual');
let tree = {
    type: 'list',
    attr: ['definition'],
    children: [
        { type: 'symbol', attr: ['keyword', 'definition'], value: 'define' },
        {
            type: 'list',
            attr: ['assignee'],
            children: [
                { type: 'symbol', attr: ['assignee'], value: 'goose' },
                { type: 'symbol', attr: ['boundVariable'], value: 'n' },
            ],
        },
        {
            type: 'list',
            attr: [],
            dropped: true, /* this should be displayed  dropped a line */
            children: [
                { type: 'symbol', attr: ['builtin'], value: '*' },
                { type: 'symbol', attr: [], value: 'n' },
                { type: 'symbol', attr: [], value: 'n' },
            ]
        },
    ]
};

const treeInfo = retagTree(tree);
let { lastId } = treeInfo;
tree = treeInfo.taggedTree;

window.syntaxTree = tree;

const treeUpdate = callback => e => {
    const ret = callback(e);

    setTimeout(() => {
        if (!ret) return;
        /* if node is being deleted */
        if (ret.deleteNode) {
            console.log('deleting', ret.deleteNode);
            deleteChild(ret.deleteNode);
            ret.elem.remove();
        }
        /* if dom tree needs refresh */
        if (ret.refresh) {
            let subtree = ret.refresh === true ? tree : ret.refresh;
            const node = renderHtml(subtree);
            /* replace entier tree */
            if (ret.refresh === true)
                editorElem.replaceChildren(node);
            else /* replace subtree */
                ret.elem.replaceWith(node);
        }
        /* rerender dirty nodes */
        for (const id in dirtyNodes) {
            console.log('dirty node', id, dirtyNodes);
            const node = renderHtml(dirtyNodes[id]);
            const elem = document.getElementById(`syntax-id-${id}`);
            elem.replaceWith(node);
            dirtyNodes = {};
        }
        /* set cursor focus */
        if (ret.refocus) {
            setCursorFocus();
        }
        textElem.innerText = syntaxTreeToText(tree);
    }, 10);

    return ret;
};

const renderProgram = () =>
    treeUpdate(e => e)({ refresh: true });

