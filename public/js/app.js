import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// --- 設定エリア (自分のSupabaseプロジェクトの値をここに入れる) ---
const SUPABASE_URL = "https://vqhwkbbzeqxlkqqjfrxr.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxaHdrYmJ6ZXF4bGtxcWpmcnhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MzE5NTUsImV4cCI6MjA4NjMwNzk1NX0.e1Dyu55POIUEg-Vb0ofTCWB8ZFU_zLL7thOQg3MBJnA";
// -------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const DOMAIN_SUFFIX = "@linkmanager.com";
const BLOCKED_DOMAINS = ['google.', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'github.com', 'yahoo.', 'amazon.', 'netflix.com'];

// XSS対策
const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// 認証ロジック
const AuthLogic = {
    isLoginMode: true,
    currentUser: null,
    
    init() {
        // 認証状態の監視
        supabase.auth.onAuthStateChange(async (event, session) => {
            this.currentUser = session?.user || null;
            const overlay = document.getElementById('authOverlay');
            const container = document.getElementById('appContainer');
            const userNameEl = document.getElementById('menuUserName');
            
            if (this.currentUser) {
                // ログイン時
                overlay.style.opacity = '0';
                setTimeout(() => overlay.style.display = 'none', 300);
                container.style.display = 'flex';
                
                const name = this.currentUser.user_metadata?.display_name || this.currentUser.email.split('@')[0];
                if (userNameEl) userNameEl.textContent = name;
                
                AppLogic.init(this.currentUser);
            } else {
                // 未ログイン時
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
        let error;

        try {
            if (this.isLoginMode) {
                const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: pass });
                error = signInError;
            } else {
                const { error: signUpError } = await supabase.auth.signUp({
                    email,
                    password: pass,
                    options: { data: { display_name: nick } }
                });
                error = signUpError;
            }
        } catch (e) {
            error = e;
        }

        if (error) {
            console.error(error);
            if (error.message.includes('Invalid login')) errorEl.textContent = "ニックネームかパスワードが違います";
            else if (error.message.includes('already registered')) errorEl.textContent = "そのニックネームは既に使用されています";
            else errorEl.textContent = "エラー: " + error.message;
        }
    },
    
    async logout() { await supabase.auth.signOut(); },
    
    async confirmDeleteAccount() {
        if (!confirm("【警告】アカウントを削除しますか？\n(注意: 現在の仕様ではログアウトのみ行います。完全削除には管理者権限が必要です)")) return;
        await this.logout();
    }
};

// アプリ本体ロジック
const AppLogic = {
    data: { appTitle: "Link Manager", folders: [], links: [], bgConfig: { value: 'stars' } },
    state: { activeFolderId: 'all', selectedLinkIds: new Set(), isMultiViewMode: false, sortOrder: 'dateDesc', searchQuery: '' },
    currentUser: null,
    dragSrcIndex: null, previewDragSrcIndex: null,

    async init(user) {
        this.currentUser = user;
        await this.fetchAllData();
    },

    reset() {
        this.currentUser = null;
        this.data = { appTitle: "Link Manager", folders: [], links: [], bgConfig: { value: 'stars' } };
    },

    async fetchAllData() {
        if (!this.currentUser) return;

        // 1. プロファイル取得
        const { data: profile } = await supabase.from('profiles').select('*').single();
        if (profile) {
            this.data.appTitle = profile.app_title || "Link Manager";
            this.data.bgConfig = profile.bg_config || { value: 'stars' };
            document.getElementById('appTitleInput').value = this.data.appTitle;
        }

        // 2. フォルダ取得
        const { data: folders } = await supabase.from('folders').select('*').order('created_at', { ascending: true });
        this.data.folders = folders || [];

        // 3. リンク取得
        const { data: links } = await supabase.from('links').select('*').order('created_at', { ascending: false });
        this.data.links = links || [];

        this.renderMenu();
        this.renderLinks();
    },

    // --- データ操作 ---

    async saveAppTitle(val) {
        this.data.appTitle = val;
        await supabase.from('profiles').update({ app_title: val }).eq('id', this.currentUser.id);
    },

    async saveFolder() { 
        const id = document.getElementById('editFolderId').value; 
        const name = document.getElementById('inputFolderName').value.trim(); 
        if (!name) return; 

        if (id) {
            // 更新
            const { error } = await supabase.from('folders').update({ name }).eq('id', id);
            if (!error) {
                const f = this.data.folders.find(x => x.id === id);
                if (f) f.name = name;
            }
        } else { 
            // 新規作成
            const { data, error } = await supabase.from('folders').insert({ user_id: this.currentUser.id, name }).select().single();
            if (!error && data) this.data.folders.push(data);
        }
        this.renderMenu();
        this.closeModals(); 
    },

    async deleteFolder(id) { 
        if (!confirm('フォルダを削除しますか？\n（中のリンクも削除されます）')) return; 
        
        const { error } = await supabase.from('folders').delete().eq('id', id);
        if (!error) {
            this.data.folders = this.data.folders.filter(x => x.id !== id);
            this.data.links = this.data.links.filter(x => x.folder_id !== id);
            this.selectFolder('all');
        } else {
            alert('削除に失敗しました: ' + error.message);
        }
    },

    async saveLink() { 
        const id = document.getElementById('editLinkId').value; 
        const title = document.getElementById('inputLinkTitle').value.trim(); 
        const url = document.getElementById('inputLinkUrl').value.trim(); 
        const tags = document.getElementById('inputLinkTags').value.split(',').map(x => x.trim()).filter(x => x); 
        const fid = document.getElementById('selectFolder').value; 
        const canEmbed = !document.getElementById('checkNoEmbed').checked; 
        
        if (!title || !url) return; 

        const payload = {
            title, url, tags, 
            folder_id: fid, 
            can_embed: canEmbed,
            user_id: this.currentUser.id
        };

        if (id) { 
            const { error } = await supabase.from('links').update(payload).eq('id', id);
            if (!error) await this.fetchAllData(); 
        } else { 
            const { error } = await supabase.from('links').insert(payload);
            if (!error) await this.fetchAllData();
        }
        this.closeModals(); 
    },

    async deleteSelectedLinks() {
        if (!confirm(`選択した ${this.state.selectedLinkIds.size} 件を削除しますか？`)) return;
        const targets = Array.from(this.state.selectedLinkIds);
        
        const { error } = await supabase.from('links').delete().in('id', targets);
        
        if (!error) {
            this.state.selectedLinkIds.clear();
            this.state.isMultiViewMode = false;
            document.getElementById('sidebar').classList.remove('hidden');
            this.closePreview();
            await this.fetchAllData();
            this.updateUI();
        } else {
            alert("削除エラー: " + error.message);
        }
    },

    // --- UI操作 ---
    onSearch(val) {
        this.state.searchQuery = val.trim().toLowerCase();
        const titleEl = document.getElementById('currentFolderName');
        if (this.state.searchQuery) {
            titleEl.textContent = `🔍 "${val}"`; 
            this.state.activeFolderId = null;
            this.renderMenu();
        } else { this.selectFolder('all'); }
        this.renderLinks();
    },

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

    // ドラッグ＆ドロップ (並び替えは見た目のみ)
    handleDragStart(e, i) { this.dragSrcIndex = i; e.dataTransfer.effectAllowed = 'move'; e.target.classList.add('dragging'); },
    handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.target.closest('.menu-item')?.classList.add('drag-over'); return false; },
    handleDragLeave(e) { e.target.closest('.menu-item')?.classList.remove('drag-over'); },
    async handleDrop(e, i) {
        e.stopPropagation(); e.target.closest('.menu-item')?.classList.remove('drag-over');
        // 将来的にDBに並び順カラムを追加すれば保存可能
        return false;
    },

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

    // 描画ロジック
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
            
            li.ondragstart = (e) => this.handleDragStart(e, i); 
            li.ondragover = (e) => this.handleDragOver(e); 
            li.ondragleave = (e) => this.handleDragLeave(e); 
            li.ondrop = (e) => this.handleDrop(e, i);
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = `📁 ${f.name}`;
            nameSpan.style.flexGrow = '1';
            nameSpan.onclick = () => this.selectFolder(f.id);

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
            links = links.filter(l => l.folder_id === this.state.activeFolderId); 
        }

        if (this.state.sortOrder === 'dateDesc') links.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        else if (this.state.sortOrder === 'dateAsc') links.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        else if (this.state.sortOrder === 'nameAsc') links.sort((a, b) => a.title.localeCompare(b.title));
        else if (this.state.sortOrder === 'nameDesc') links.sort((a, b) => b.title.localeCompare(a.title));

        if (links.length === 0) {
            grid.innerHTML = `<div style="color:#aaa; grid-column:1/-1; text-align:center; margin-top:50px; font-size:0.9rem;">リンクがありません</div>`;
            return;
        }

        links.forEach(link => {
            const isSel = this.state.selectedLinkIds.has(link.id);
            const canEmbed = (link.can_embed !== false);
            const card = document.createElement('div');
            card.className = `link-card ${isSel ? 'selected' : ''}`;
            
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
        let basis = count === 1 ? 'calc(100% - 100px)' : (count === 2 ? 'calc(50% - 40px)' : 'calc(33.333% - 30px)');

        targets.forEach((l, i) => {
            const canEmbed = (l.can_embed !== false);
            const div = document.createElement('div');
            div.className = 'preview-frame-wrapper';
            div.style.flex = `0 0 ${basis}`;
            div.draggable = true;
            div.ondragstart = (e) => this.handlePvDragStart(e, i);
            div.ondragover = (e) => this.handlePvDragOver(e);
            div.ondragleave = (e) => this.handlePvDragLeave(e);
            div.ondrop = (e) => this.handlePvDrop(e, i);

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
    
    openLinkModal(id) { 
        document.getElementById('linkModal').style.display = 'flex'; 
        document.getElementById('editLinkId').value = id || ''; 
        const l = id ? this.data.links.find(x => x.id === id) : {}; 
        document.getElementById('inputLinkTitle').value = l.title || ''; 
        document.getElementById('inputLinkUrl').value = l.url || ''; 
        document.getElementById('inputLinkTags').value = (l.tags || []).join(','); 
        document.getElementById('selectFolder').value = l.folder_id || (this.state.activeFolderId === 'all' && this.data.folders[0] ? this.data.folders[0].id : this.state.activeFolderId); 
        document.getElementById('checkNoEmbed').checked = (l.can_embed === false); 
    },
    
    isBlockedDomain(url) { 
        try { return BLOCKED_DOMAINS.some(d => new URL(url).hostname.includes(d)); } catch (e) { return false; } 
    },
    
    autoDetectEmbed(url) { 
        if (this.isBlockedDomain(url)) document.getElementById('checkNoEmbed').checked = true; 
    },
    
    closeModals() { document.querySelectorAll('.modal-overlay').forEach(e => e.style.display = 'none'); },
    openBgModal() { alert("壁紙設定機能は準備中です"); }, 
    saveBgSettings() { this.closeModals(); }
};

// HTMLからのアクセス用
window.Auth = AuthLogic;
window.App = AppLogic;

// アプリ開始
AuthLogic.init();