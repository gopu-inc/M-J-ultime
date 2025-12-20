
// --- CONFIGURATION ---
const API_URL = "https://mj-hub.onrender.com";
const WS_URL = "wss://mj-hub.onrender.com/ws"; 

// --- STATE MANAGEMENT ---
const state = {
    token: localStorage.getItem('mj_token'),
    user: JSON.parse(localStorage.getItem('mj_user') || 'null'),
    socket: null,
    activeChat: null,
    feedCursor: null,
    isLoading: false,
    hls: null
};

// --- API HELPER ---
const api = async (endpoint, options = {}) => {
    const headers = { 'Authorization': `Bearer ${state.token}` };
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
    if (res.status === 401) app.logout();
    return res.json();
};

// --- UI CONTROLLER ---
const ui = {
    showSplash: () => setTimeout(() => document.getElementById('splash-screen').classList.add('hidden'), 2000),
    
    toggleAuthMode: () => {
        const isRegister = document.getElementById('btn-login').classList.contains('hidden');
        document.getElementById('btn-login').classList.toggle('hidden');
        document.getElementById('btn-register').classList.toggle('hidden');
        document.getElementById('email-group').classList.toggle('hidden');
        document.getElementById('switch-text').innerText = isRegister ? 'Pas de compte ?' : 'Déjà un compte ?';
    },

    toast: (msg, type='info') => {
        const t = document.getElementById('toast-overlay');
        const el = document.createElement('div');
        el.className = `toast-msg ${type}`;
        el.innerText = msg;
        el.style.cssText = `position:fixed; top:50px; left:50%; transform:translateX(-50%); background:${type==='error'?'#ff3b30':'#34c759'}; color:white; padding:10px 20px; border-radius:20px; font-weight:600; z-index:9999; box-shadow:0 4px 10px rgba(0,0,0,0.3); animation: fadeIn 0.3s;`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    },

    goToSection: (sec) => {
        document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
        document.getElementById(`${sec}-section`).classList.remove('hidden');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        // Highlight logic
        const mapping = { 'feed': 0, 'lives': 1, 'chat': 3, 'profile': 4 };
        if (mapping[sec] !== undefined) document.querySelectorAll('.nav-btn')[mapping[sec]].classList.add('active');
        
        if(sec === 'feed') app.playVisibleVideo();
        else app.pauseAllVideos();

        if(sec === 'lives') app.loadLives();
        if(sec === 'chat') app.loadConversations();
        if(sec === 'profile') app.loadProfile();
    },

    openModal: (id) => document.getElementById(id).classList.remove('hidden'),
    closeModal: (id) => document.getElementById(id).classList.add('hidden'),
    
    handleFileSelect: (input) => {
        const file = input.files[0];
        if(file) document.getElementById('file-preview').innerText = `Sélectionné: ${file.name}`;
    },

    previewAvatar: (input) => {
        const file = input.files[0];
        if(file) document.getElementById('edit-avatar-preview').src = URL.createObjectURL(file);
    }
};

// --- APP LOGIC ---
const app = {
    init: () => {
        ui.showSplash();
        if (state.token) {
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('app-screen').classList.remove('hidden');
            app.connectWS();
            app.loadFeed();
        } else {
            document.getElementById('auth-screen').classList.remove('hidden');
        }
        
        // Scroll Observer for Auto-play
        document.getElementById('video-scroller').addEventListener('scroll', app.handleScroll);
    },

    // AUTH
    login: async () => {
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        const fd = new URLSearchParams(); fd.append('username', u); fd.append('password', p);
        
        try {
            const res = await fetch(`${API_URL}/token`, { method: 'POST', body: fd });
            const data = await res.json();
            if(!res.ok) throw new Error('Erreur login');
            
            localStorage.setItem('mj_token', data.access_token);
            localStorage.setItem('mj_user', JSON.stringify({id: data.user_id, username: data.username}));
            location.reload();
        } catch(e) { ui.toast('Identifiants incorrects', 'error'); }
    },

    register: async () => {
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        const e = document.getElementById('email').value;
        
        try {
            const res = await fetch(`${API_URL}/api/users/register`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: u, password: p, email: e || null})
            });
            if(!res.ok) throw new Error('Erreur inscription');
            ui.toast('Compte créé ! Connectez-vous.');
            ui.toggleAuthMode();
        } catch(e) { ui.toast('Erreur création compte', 'error'); }
    },

    logout: () => {
        localStorage.clear();
        location.reload();
    },

    // FEED & VIDEO LOGIC
    loadFeed: async () => {
        const container = document.getElementById('video-scroller');
        if(container.children.length > 1) return; // Prevent reload if loaded

        try {
            const videos = await api(`/api/feed?limit=10`);
            container.innerHTML = videos.map(v => `
                <div class="video-snap-item">
                    <video class="video-player" src="${v.video_url}" loop playsinline poster="${v.thumbnail_url}" onclick="app.togglePlay(this)"></video>
                    <div class="video-overlay">
                        <div class="meta-username">@${v.username}</div>
                        <div class="meta-desc">${v.description}</div>
                    </div>
                    <div class="video-sidebar">
                        <div class="avatar-container" onclick="app.viewProfile('${v.user_id}')">
                            <img src="${v.avatar_url || 'https://via.placeholder.com/50'}" style="width:45px; height:45px; border-radius:50%; border:2px solid white;">
                        </div>
                        <div class="action-btn" onclick="app.likeVideo(this)">
                            <div class="action-icon like-heart"><i class="fas fa-heart"></i></div>
                            <span>${v.likes}</span>
                        </div>
                        <div class="action-btn">
                            <div class="action-icon"><i class="fas fa-comment-dots"></i></div>
                            <span>0</span>
                        </div>
                    </div>
                </div>
            `).join('');
            app.playVisibleVideo();
        } catch(e) { console.error(e); }
    },

    handleScroll: () => {
        clearTimeout(window.scrollTimeout);
        window.scrollTimeout = setTimeout(app.playVisibleVideo, 100);
    },

    playVisibleVideo: () => {
        const container = document.getElementById('video-scroller');
        const videos = document.querySelectorAll('.video-player');
        
        videos.forEach(v => {
            const rect = v.getBoundingClientRect();
            // Si la vidéo est principalement visible
            if (rect.top >= -100 && rect.bottom <= (window.innerHeight + 100)) {
                v.play().catch(e => console.log('Autoplay blocked'));
            } else {
                v.pause();
                v.currentTime = 0;
            }
        });
    },

    pauseAllVideos: () => document.querySelectorAll('video').forEach(v => v.pause()),
    
    togglePlay: (video) => video.paused ? video.play() : video.pause(),

    likeVideo: (el) => {
        const icon = el.querySelector('.like-heart');
        icon.classList.toggle('active');
        // Animation simple (Le backend n'a pas encore de endpoint like dédié dans le snippet, juste visuel ici)
    },

    // UPLOAD
    uploadVideo: async () => {
        const file = document.getElementById('video-file').files[0];
        const desc = document.getElementById('video-desc').value;
        const isPublic = document.getElementById('is-public').checked;
        
        if(!file) return ui.toast('Sélectionnez une vidéo', 'error');

        document.getElementById('upload-progress').classList.remove('hidden');
        const bar = document.querySelector('.fill');
        bar.style.width = '50%'; // Fake progress pour UX

        const fd = new FormData();
        fd.append('video', file);
        fd.append('description', desc);
        fd.append('is_public', isPublic);

        try {
            await api('/api/videos/upload', { method: 'POST', body: fd });
            bar.style.width = '100%';
            ui.toast('Vidéo publiée !');
            ui.closeModal('upload-modal');
            app.loadFeed(); // Reload feed
        } catch(e) {
            ui.toast('Erreur upload', 'error');
        } finally {
            document.getElementById('upload-progress').classList.add('hidden');
            bar.style.width = '0%';
        }
    },

    // LIVES
    loadLives: async () => {
        const lives = await api('/api/lives/active');
        const grid = document.getElementById('lives-grid');
        
        if(lives.length === 0) {
            grid.innerHTML = '<p style="color:#666; width:200%;">Aucun live en cours</p>';
            return;
        }

        grid.innerHTML = lives.map(l => `
            <div class="live-card" onclick="app.watchLive('${l.stream_key}', '${l.id}')">
                <img src="${l.thumbnail_url || 'https://via.placeholder.com/200'}" class="live-thumb">
                <div class="live-badge-card">LIVE</div>
                <div style="position:absolute; bottom:10px; left:10px; font-weight:bold;">${l.title}</div>
            </div>
        `).join('');
    },

    watchLive: (key, id) => {
        const video = document.getElementById('main-live-video');
        const hlsUrl = `${API_URL}/live/${key}/index.m3u8`; // URL HLS générée par le serveur

        document.getElementById('live-player-overlay').classList.remove('hidden');
        
        if (Hls.isSupported()) {
            state.hls = new Hls();
            state.hls.loadSource(hlsUrl);
            state.hls.attachMedia(video);
            state.hls.on(Hls.Events.MANIFEST_PARSED, () => video.play());
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = hlsUrl;
            video.addEventListener('loadedmetadata', () => video.play());
        }
        
        // Join socket room for chat
        state.socket.send(JSON.stringify({ type: 'join_live', live_id: id }));
        state.activeLiveId = id;
    },

    sendLiveComment: () => {
        const inp = document.getElementById('live-comment-input');
        if(inp.value && state.activeLiveId) {
            state.socket.send(JSON.stringify({
                type: 'live_comment',
                live_id: state.activeLiveId,
                comment: inp.value
            }));
            inp.value = '';
        }
    },

    // PROFILE
    loadProfile: async (id = 'me') => {
        const p = await api(id === 'me' ? '/api/users/me' : `/api/users/${id}`);
        const isMe = id === 'me' || p.id === state.user.id;
        
        const html = `
            <div class="profile-header">
                <img src="${p.avatar_url || 'https://via.placeholder.com/150'}" class="profile-avatar">
                <h2>@${p.username}</h2>
                <p>${p.bio || 'Aucune bio.'}</p>
                <div class="stats-row">
                    <div class="stat-item"><span class="stat-num">${p.followers_count}</span><span class="stat-label">Abonnés</span></div>
                    <div class="stat-item"><span class="stat-num">${p.following_count}</span><span class="stat-label">Abonnements</span></div>
                    <div class="stat-item"><span class="stat-num">${p.likes_received}</span><span class="stat-label">J'aime</span></div>
                </div>
                ${isMe 
                    ? `<button class="btn-outline" onclick="ui.openModal('edit-profile-modal')">Modifier le profil</button>
                       <button class="btn-outline" style="border-color:#ff3b30; color:#ff3b30; margin-left:10px" onclick="app.logout()">Déconnexion</button>`
                    : `<button class="btn-main" style="width:auto; padding:8px 30px" onclick="app.follow('${p.id}')">S'abonner</button>`
                }
            </div>
        `;
        document.getElementById(isMe ? 'my-profile-container' : 'my-profile-container').innerHTML = html; 
        // Note: For full app, separate 'view profile' screen is needed.
    },

    updateProfile: async () => {
        const bio = document.getElementById('edit-bio').value;
        const avatar = document.getElementById('avatar-file').files[0];
        
        const fd = new FormData();
        if(bio) fd.append('bio', bio);
        if(avatar) fd.append('avatar', avatar);
        
        await api('/api/users/me', { method: 'PUT', body: fd });
        ui.closeModal('edit-profile-modal');
        app.loadProfile();
    },

    // CHAT & SOCKET
    connectWS: () => {
        state.socket = new WebSocket(`${WS_URL}/${state.user.id}`);
        state.socket.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if(data.type === 'new_message') {
                if(state.activeChat === data.sender_id) app.appendMsg(data, 'received');
                else ui.toast(`Message de ${data.sender_username}`);
            } else if (data.type === 'live_comment') {
                const chatDiv = document.getElementById('live-chat-overlay');
                chatDiv.innerHTML += `<div class="live-chat-msg"><b>${data.comment.username}:</b> ${data.comment.message}</div>`;
                chatDiv.scrollTop = chatDiv.scrollHeight;
            }
        };
    },
    
    loadConversations: async () => {
        const convs = await api('/api/messages/conversations');
        document.getElementById('conversations-list').innerHTML = convs.map(c => `
            <div onclick="app.openChat('${c.user_id}', '${c.username}', '${c.avatar_url}')" style="display:flex; align-items:center; padding:15px; border-bottom:1px solid #222;">
                <img src="${c.avatar_url || 'https://via.placeholder.com/50'}" style="width:50px; height:50px; border-radius:50%; margin-right:15px;">
                <div style="flex:1;">
                    <div style="font-weight:bold;">${c.username}</div>
                    <div style="color:#888; font-size:0.9rem;">${c.last_message}</div>
                </div>
            </div>
        `).join('');
    },

    openChat: async (id, name, avatar) => {
        state.activeChat = id;
        document.getElementById('chat-header-username').innerText = name;
        document.getElementById('chat-header-avatar').src = avatar || 'https://via.placeholder.com/40';
        document.getElementById('chat-view').classList.remove('hidden');
        
        const msgs = await api(`/api/messages/${id}`);
        const box = document.getElementById('messages-container');
        box.innerHTML = '';
        msgs.forEach(m => app.appendMsg(m, m.sender_id === state.user.id ? 'sent' : 'received'));
    },

    sendMessage: async () => {
        const input = document.getElementById('message-input');
        const txt = input.value;
        if(!txt) return;
        
        app.appendMsg({content: txt}, 'sent');
        input.value = '';
        
        await api('/api/messages/send', {
            method: 'POST',
            body: JSON.stringify({receiver_id: state.activeChat, content: txt})
        });
    },

    appendMsg: (msg, type) => {
        const box = document.getElementById('messages-container');
        box.innerHTML += `<div class="msg-bubble ${type}">${msg.content}</div>`;
        box.scrollTop = box.scrollHeight;
    },

    startLiveSetup: async () => {
        const title = prompt('Titre du live ?');
        if(title) {
            const res = await api('/api/lives/start', { 
                method: 'POST', 
                body: JSON.stringify({title, is_private: false}) 
            });
            alert(`Stream Key: ${res.stream_key}\nServer: rtmp://mj-hub.onrender.com/live`);
        }
    }
};

ui.closeChat = () => document.getElementById('chat-view').classList.add('hidden');
ui.closeLive = () => {
    document.getElementById('live-player-overlay').classList.add('hidden');
    if(state.hls) state.hls.destroy();
    document.getElementById('main-live-video').pause();
};

document.addEventListener('DOMContentLoaded', app.init);
