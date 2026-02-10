import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, deleteUser, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Security Utility: XSS Prevention
const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const firebaseConfig = {
    apiKey: "AIzaSyBQc23NX-S5_1_K5IWYDGWPrzWBxt6n6eA",
    authDomain: "link-manager-487e8.firebaseapp.com",
    projectId: "link-manager-487e8",
    storageBucket: "link-manager-487e8.firebasestorage.app",
    messagingSenderId: "636591119372",
    appId: "1:636591119372:web:6dfc06cdf853f4c882a229"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const DOMAIN_SUFFIX = "@linkmanager.local";
const BLOCKED_DOMAINS = ['google.', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'github.com', 'yahoo.', 'amazon.', 'netflix.com'];

// Core App Logic
const AuthLogic = {
    isLoginMode: true,
    currentUser: null,
    init() {
        onAuthStateChanged(auth, (user) => {
            this.currentUser = user;
            const overlay = document.getElementById('authOverlay');
            const container = document.getElementById('appContainer');
            const userNameEl = document.getElementById('menuUserName');
            
            if (user) {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.style.display = 'none', 300);
                container.style.display = 'flex';
                const name = user.displayName || user.email.split('@')[0];
                if (userNameEl) userNameEl.textContent = name;
                AppLogic.init(user);
            } else {
                overlay.style.display = 'flex';
                setTimeout(() => overlay.style.opacity = '1', 10);
                container.style.display = 'none';
                AppLogic.reset();
            }
        });
    },
    toggleMode() {
        this.isLoginMode = !this.isLoginMode;
        document.getElementById('authTitle').textContent = this.isLoginMode ? "Link Manager" : "新規登録";
        document.getElementById('btnAction').textContent = this.isLoginMode ? "ログイン" : "登録して開始";
        document.getElementById('toggleMode').textContent = this.isLoginMode ? "アカウント作成はこちら" : "ログイン画面に戻る";
        document.getElementById('authError').textContent = "";
    },
    clearError() { document.getElementById('authError').textContent = ""; },
    async submit() {
        const nick = document.getElementById('inputNick').value.trim();
        const pass = document.getElementById('inputPass').value;
        const errorEl = document.getElementById('authError');
        if (!nick || !pass) return errorEl.textContent = "入力してください";
        if (!/^[a-zA-Z0-9]+$/.test(nick)) return errorEl.textContent = "ニックネームは半角英数字のみです";
        if (pass.length < 6) return errorEl.textContent = "パスワードは6文字以上必要です";
        const email = nick + DOMAIN_SUFFIX;
        try {
            if (this.isLoginMode) await signInWithEmailAndPassword(auth, email, pass);
            else {
                const uc = await createUserWithEmailAndPassword(auth, email, pass);
                await updateProfile(uc.user, { displayName: nick });
                // Default Data
                const defaultData = {
                    appTitle: "Link Manager",
                    folders: [{ id: 'f_default', name: 'ブックマーク' }],
                    links: [],
                    bgConfig: { value: 'stars' }
                };
                await setDoc(doc(db, "users", uc.user.uid), defaultData);
            }
        } catch (e) {
            console.error(e);
            if (e.code === 'auth/email-already-in-use') errorEl.textContent = "そのニックネームは既に使用されています";
            else if (e.code.includes('invalid') || e.code.includes('not-found') || e.code.includes('wrong-password')) {
                errorEl.textContent = "ニックネームかパスワードが違います";
                document.getElementById('inputPass').value = "";
            } else errorEl.textContent = "エラーが発生しました: " + e.message;
        }
    },
    logout() { signOut(auth); },
    async confirmDeleteAccount() {
        if (!confirm("【警告】アカウントを削除しますか？")) return;
        const pass = prompt("パスワードを入力:");
        if (!pass) return;
        try {
            const cred = EmailAuthProvider.credential(this.currentUser.email, pass);
            await reauthenticateWithCredential(this.currentUser, cred);
            await deleteDoc(doc(db, "users", this.currentUser.uid));
            await deleteUser(this.currentUser);
        } catch (e) { alert(e.message); }
    }
};

const AppLogic = {
    data: { appTitle: "Link Manager", folders: [], links: [], bgConfig: { value: 'stars' } },
    state: { activeFolderId: 'all', selectedLinkIds: new Set(), isMultiViewMode: false, sortOrder: 'dateDesc', searchQuery: '' },
    currentUser: null, unsubscribe: null, dragSrcIndex: null, previewDragSrcIndex: null,

    init(user) {
        this.currentUser = user;
        this.unsubscribe = onSnapshot(doc(db, "users", user.uid), (snap) => {
            if (snap.exists()) {
                const fetchedData = snap.data();
                this.data = {
                    appTitle: fetchedData.appTitle || "Link Manager",
                    folders: Array.isArray(fetchedData.folders) ? fetchedData.folders : [],
                    links: Array.isArray(fetchedData.links) ? fetchedData.links : [],
                    bgConfig: fetchedData.bgConfig || { value: 'stars' }
                };
                document.getElementById('appTitleInput').value = this.data.appTitle;
                this.renderMenu();
                this.renderLinks();
            } else {
                // Doc missing, create default
                this.data = { appTitle: "Link Manager", folders: [{ id: 'f_def', name: 'ブックマーク' }], links: [], bgConfig: { value: 'stars' } };
                this.saveData();
            }
        }, (error) => {
            console.error("Firestore Listen Error:", error);
            alert("データ同期エラー: ページをリロードしてください");
        });
    },
    reset() { if (this.unsubscribe) this.unsubscribe(); },
    async saveData() {
        if (this.currentUser) {
            try {
                await setDoc(doc(db, "users", this.currentUser.uid), this.data);
            } catch (e) {
                console.error("Save failed:", e);
                alert("保存に失敗しました。権限またはネットワークを確認してください。");
            }
        }
    },
    
    // --- Handlers ---
    onSearch(val) {
        this.state.searchQuery = val.trim().toLowerCase();
        const titleEl = document.getElementById('currentFolderName');
        if (this.state.searchQuery) {
            titleEl.textContent = `🔍 "${val}"`; // No XSS here as textContent
            this.state.activeFolderId = null;
            this.renderMenu();
        } else { this.selectFolder('all'); }
        this.renderLinks();
    },
    
    handleDragStart(e, i) { this.dragSrcIndex = i; e.dataTransfer.effectAllowed = 'move'; e.target.classList.add('dragging'); },
    handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.target.closest('.menu-item')?.classList.add('drag-over'); return false; },
    handleDragLeave(e) { e.target.closest('.menu-item')?.classList.remove('drag-over'); },
    async handleDrop(e, i) {
        e.stopPropagation(); e.target.closest('.menu-item')?.classList.remove('drag-over');
        document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('dragging', 'drag-over'));
        if (this.dragSrcIndex !== null && this.dragSrcIndex !== i) {
            const item = this.data.folders[this.dragSrcIndex];
            this.data.folders.splice(this.dragSrcIndex, 1);
            this.data.folders.splice(i, 0, item);
            await this.saveData();
        } return false;
    },

    // Pv Drag
    handlePvDragStart(e, index) { this.previewDragSrcIndex = index; e.dataTransfer.effectAllowed = 'move'; e.target.closest('.preview-frame-wrapper').classList.add('dragging'); },
    handlePvDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.target.closest('.preview-frame-wrapper')?.classList.add('drag-over'); return false; },
    handlePvDragLeave(e) { e.target.closest('.preview-frame-wrapper')?.classList.remove('drag-over'); },
    handlePvDrop(e, index) {
        e.stopPropagation();
        document.querySelectorAll('.preview-frame-wrapper').forEach(el => el.classList.remove('dragging', 'drag-over'));
        if (this.previewDragSrcIndex !== null && this.previewDragSrcIndex !== index) {
            const container = document.getElementById('multiView');
            const items = Array.from(container.children);
            const srcItem = items[this.previewDragSrcIndex];
            if (this.previewDragSrcIndex < index) container.insertBefore(srcItem, items[index].nextSibling);
            else container.insertBefore(srcItem, items[index]);
        }
        return false;
    },

    toggleSidebar() { document.getElementById('sidebar').classList.toggle('hidden'); },
    toggleSettingsMenu() { document.getElementById('settingsMenu').classList.toggle('show'); },
    saveAppTitle(val) { this.data.appTitle = val; this.saveData(); },
    setSort(val) { this.state.sortOrder = val; this.renderLinks(); },
    selectFolder(id) {
        this.state.activeFolderId = id; this.state.searchQuery = ''; document.getElementById('searchInput').value = '';
        this.state.isMultiViewMode = false; this.renderMenu(); this.renderLinks(); this.updateUI();
    },
    clearSelection() {
        this.state.selectedLinkIds.clear();
        this.state.isMultiViewMode = false;
        document.getElementById('sidebar').classList.remove('hidden');
        this.closePreview();
        this.updateUI();
        this.renderLinks();
    },
    async deleteSelectedLinks() {
        if (!confirm(`選択した ${this.state.selectedLinkIds.size} 件を削除しますか？`)) return;
        const targets = new Set(this.state.selectedLinkIds);
        this.state.selectedLinkIds.clear();
        this.state.isMultiViewMode = false;
        document.getElementById('sidebar').classList.remove('hidden');
        this.closePreview();
        this.updateUI();
        
        this.data.links = this.data.links.filter(l => l && !targets.has(l.id));
        this.renderLinks();
        await this.saveData();
    },
    
    renderMenu() {
        const list = document.getElementById('folderList'); const sel = document.getElementById('selectFolder');
        list.innerHTML = ''; sel.innerHTML = '';
        
        const allLi = document.createElement('li');
        allLi.className = `menu-item ${this.state.activeFolderId === 'all' && !this.state.searchQuery ? 'active' : ''}`;
        allLi.innerHTML = `<span>📂 すべてのリンク</span>`;
        allLi.onclick = () => this.selectFolder('all');
        list.appendChild(allLi);

        this.data.folders.forEach((f, i) => {
            const li = document.createElement('li');
            li.className = `menu-item draggable ${f.id === this.state.activeFolderId ? 'active' : ''}`;
            li.draggable = true;
            li.ondragstart = (e) => AppLogic.handleDragStart(e, i); 
            li.ondragover = (e) => AppLogic.handleDragOver(e); 
            li.ondragleave = (e) => AppLogic.handleDragLeave(e); 
            li.ondrop = (e) => AppLogic.handleDrop(e, i);
            
            // Securely building HTML
            const nameSpan = document.createElement('span');
            nameSpan.textContent = `📁 ${f.name}`;
            nameSpan.style.flexGrow = '1';
            nameSpan.onclick = () => AppLogic.selectFolder(f.id);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'menu-actions';
            actionsDiv.innerHTML = `<span onclick="App.openFolderModal('${f.id}')">✎</span><span onclick="App.deleteFolder('${f.id}')" style="margin-left:8px;">✕</span>`;

            li.appendChild(nameSpan);
            li.appendChild(actionsDiv);
            list.appendChild(li);

            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = f.name;
            sel.appendChild(opt);
        });
        
        if (!this.state.searchQuery) {
            const currentFolder = this.data.folders.find(x => x.id === this.state.activeFolderId);
            document.getElementById('currentFolderName').textContent = this.state.activeFolderId === 'all' ? "すべてのリンク" : (currentFolder?.name || "...");
        }
    },

    renderLinks() {
        const grid = document.getElementById('gridView');
        const multi = document.getElementById('multiView');

        if (this.state.isMultiViewMode) {
            grid.style.display = 'none';
            multi.style.display = 'flex';
            this.renderMultiView();
            return;
        } else {
            grid.style.display = 'grid';
            multi.style.display = 'none';
        }

        grid.innerHTML = '';
        let links = [...this.data.links];

        if (this.state.searchQuery) {
            const q = this.state.searchQuery;
            links = links.filter(l => l.title.toLowerCase().includes(q) || l.url.toLowerCase().includes(q) || (l.tags && l.tags.some(t => t.toLowerCase().includes(q))));
        } else if (this.state.activeFolderId !== 'all') {
            links = links.filter(l => l.folderId === this.state.activeFolderId);
        }

        if (this.state.sortOrder === 'dateDesc') links.sort((a, b) => (b.id > a.id ? 1 : -1));
        else if (this.state.sortOrder === 'dateAsc') links.sort((a, b) => (a.id > b.id ? 1 : -1));
        else if (this.state.sortOrder === 'nameAsc') links.sort((a, b) => a.title.localeCompare(b.title));
        else if (this.state.sortOrder === 'nameDesc') links.sort((a, b) => b.title.localeCompare(a.title));

        if (links.length === 0) {
            grid.innerHTML = `<div style="color:#aaa; grid-column:1/-1; text-align:center; margin-top:50px; font-size:0.9rem;">リンクがありません</div>`;
            return;
        }

        links.forEach(link => {
            const isSel = this.state.selectedLinkIds.has(link.id);
            const canEmbed = (link.canEmbed !== false);
            const card = document.createElement('div');
            card.className = `link-card ${isSel ? 'selected' : ''}`;
            
            // Secure Content Injection
            const safeTitle = escapeHtml(link.title);
            const safeTags = (link.tags || []).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
            
            card.innerHTML = `
                <div class="card-upper"><div class="link-title">${safeTitle}</div></div>
                <div class="card-lower">
                    <div class="card-tags">${safeTags}</div>
                    <div class="card-actions">
                        <span class="mini-btn" onclick="App.openLinkModal('${link.id}')">✎</span>
                        ${canEmbed ? `<span class="mini-btn" onclick="App.openPreview('${link.id}')" title="プレビュー">👁️</span>` : `<span class="mini-btn" onclick="window.open('${escapeHtml(link.url)}','_blank')">🚀</span>`}
                    </div>
                </div>`;
                
            card.onclick = (e) => {
                if (e.target.closest('.card-actions')) return;
                this.toggleSelection(link.id);
            };
            grid.appendChild(card);
        });
        this.updateUI();
    },
    toggleSelection(id) { if (this.state.selectedLinkIds.has(id)) this.state.selectedLinkIds.delete(id); else this.state.selectedLinkIds.add(id); this.renderLinks(); this.updateUI(); },
    updateUI() {
        const count = this.state.selectedLinkIds.size; const area = document.getElementById('selectionArea');
        if (count > 0) { area.style.display = 'flex'; document.getElementById('selectionCount').textContent = `${count}件選択`; document.getElementById('btnMultiPreview').disabled = false; document.getElementById('btnMultiDelete').style.display = 'inline-block'; }
        else { area.style.display = 'none'; document.getElementById('btnMultiPreview').disabled = true; document.getElementById('btnMultiDelete').style.display = 'none'; }
    },
    toggleMultiView() { this.state.isMultiViewMode = !this.state.isMultiViewMode; if (this.state.isMultiViewMode) document.getElementById('sidebar').classList.add('hidden'); else document.getElementById('sidebar').classList.remove('hidden'); this.renderLinks(); },
    renderMultiView() {
        const con = document.getElementById('multiView');
        con.innerHTML = '';
        const targets = this.data.links.filter(l => this.state.selectedLinkIds.has(l.id));
        const count = targets.length;

        let basis = '300px';
        if (count === 1) basis = 'calc(100% - 100px)';
        else if (count === 2) basis = 'calc(50% - 40px)';
        else basis = 'calc(33.333% - 30px)';

        targets.forEach((l, i) => {
            const canEmbed = (l.canEmbed !== false);
            const div = document.createElement('div');
            div.className = 'preview-frame-wrapper';
            div.style.flex = `0 0 ${basis}`;
            div.draggable = true;
            div.ondragstart = (e) => AppLogic.handlePvDragStart(e, i);
            div.ondragover = (e) => AppLogic.handlePvDragOver(e);
            div.ondragleave = (e) => AppLogic.handlePvDragLeave(e);
            div.ondrop = (e) => AppLogic.handlePvDrop(e, i);

            // XSS Prevention: Safe URL insertion
            const safeUrl = escapeHtml(l.url);
            const safeTitle = escapeHtml(l.title);

            let content = canEmbed
                ? `<iframe src="${safeUrl}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>`
                : `<div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; color:#333; background:#f0f0f0;"><p style="margin-bottom:10px;font-size:0.9rem;color:#666;">${safeUrl}</p><button class="btn-primary" onclick="window.open('${safeUrl}','_blank')">外部で開く</button></div>`;

            div.innerHTML = `<div class="preview-header"><span>${safeTitle}</span><span style="font-size:0.7rem; opacity:0.7;">☰ Drag</span></div>${content}`;
            con.appendChild(div);
        });
    },
    openPreview(id) { 
        const l = this.data.links.find(x => x.id === id); 
        document.getElementById('previewTitle').textContent = l.title; 
        document.getElementById('previewExtLink').href = l.url; 
        document.getElementById('previewFrame').src = l.url; 
        document.getElementById('previewPanel').classList.add('open'); 
    },
    closePreview() { 
        document.getElementById('previewPanel').classList.remove('open'); 
        setTimeout(() => document.getElementById('previewFrame').src = '', 300); 
    },
    openFolderModal(id) { 
        document.getElementById('folderModal').style.display = 'flex'; 
        document.getElementById('editFolderId').value = id || ''; 
        document.getElementById('inputFolderName').value = id ? this.data.folders.find(x => x.id === id).name : ''; 
    },
    async saveFolder() { 
        const id = document.getElementById('editFolderId').value; 
        const name = document.getElementById('inputFolderName').value.trim(); 
        if (!name) return; 
        if (id) this.data.folders.find(x => x.id === id).name = name; 
        else this.data.folders.push({ id: 'f' + Date.now(), name }); 
        await this.saveData(); 
        this.closeModals(); 
    },
    async deleteFolder(id) { 
        if (!confirm('フォルダを削除しますか？')) return; 
        this.data.folders = this.data.folders.filter(x => x.id !== id); 
        this.data.links = this.data.links.filter(x => x.folderId !== id); 
        this.selectFolder('all'); 
        await this.saveData(); 
    },
    openLinkModal(id) { 
        document.getElementById('linkModal').style.display = 'flex'; 
        document.getElementById('editLinkId').value = id || ''; 
        const l = id ? this.data.links.find(x => x.id === id) : {}; 
        document.getElementById('inputLinkTitle').value = l.title || ''; 
        document.getElementById('inputLinkUrl').value = l.url || ''; 
        document.getElementById('inputLinkTags').value = (l.tags || []).join(','); 
        document.getElementById('selectFolder').value = l.folderId || (this.state.activeFolderId === 'all' && this.data.folders[0] ? this.data.folders[0].id : this.state.activeFolderId); 
        document.getElementById('checkNoEmbed').checked = (l.canEmbed === false); 
    },
    async saveLink() { 
        const id = document.getElementById('editLinkId').value; 
        const title = document.getElementById('inputLinkTitle').value.trim(); 
        const url = document.getElementById('inputLinkUrl').value.trim(); 
        const tags = document.getElementById('inputLinkTags').value.split(',').map(x => x.trim()).filter(x => x); 
        const fid = document.getElementById('selectFolder').value; 
        const canEmbed = !document.getElementById('checkNoEmbed').checked; 
        if (!title || !url) return; 
        if (id) { 
            const idx = this.data.links.findIndex(x => x.id === id); 
            if (idx > -1) this.data.links[idx] = { ...this.data.links[idx], title, url, tags, folderId: fid, canEmbed }; 
        } else { 
            this.data.links.push({ id: 'l' + Date.now(), title, url, tags, folderId: fid, canEmbed }); 
        } 
        await this.saveData(); 
        this.closeModals(); 
    },
    isBlockedDomain(url) { 
        try { return BLOCKED_DOMAINS.some(d => new URL(url).hostname.includes(d)); } catch (e) { return false; } 
    },
    autoDetectEmbed(url) { 
        if (this.isBlockedDomain(url)) document.getElementById('checkNoEmbed').checked = true; 
    },
    closeModals() { 
        document.querySelectorAll('.modal-overlay').forEach(e => e.style.display = 'none'); 
    },
    openBgModal() { alert("壁紙設定機能は準備中です"); }, // Stub for safety
    saveBgSettings() { this.closeModals(); }
};

// Expose to window for HTML event handlers
window.Auth = AuthLogic;
window.App = AppLogic;

AuthLogic.init();