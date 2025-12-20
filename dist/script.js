// --- CONFIGURATION ---
const API_URL = "https://mj-hub.onrender.com";
const WS_URL = "wss://mj-hub.onrender.com/ws"; // WebSocket Secure

// --- ÉTAT GLOBAL ---
const state = {
    token: localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    socket: null,
    activeChatId: null,
    conversations: [],
    notifications: []
};

// --- GESTION INTERFACE (UI) ---
const ui = {
    toggleAuth: (mode) => {
        document.getElementById('login-form').classList.toggle('hidden', mode === 'register');
        document.getElementById('register-form').classList.toggle('hidden', mode === 'login');
    },

    showSection: (sectionId) => {
        // Mettre à jour la nav
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        // Trouver l'icône correspondante (logique simple basée sur l'ordre)
        const mapping = {'feed':0, 'lives':1, 'upload':2, 'chat':3, 'profile':4};
        if(mapping[sectionId] !== undefined) document.querySelectorAll('.nav-item')[mapping[sectionId]].classList.add('active');

        // Afficher la section
        document.querySelectorAll('section').forEach(el => el.classList.remove('active-section'));
        const target = document.getElementById(`${sectionId}-section`);
        if(target) target.classList.add('active-section');

        // Recharger les données si nécessaire
        if (sectionId === 'feed') app.loadFeed();
        if (sectionId === 'lives') app.loadLives();
        if (sectionId === 'chat') app.loadConversations();
        if (sectionId === 'notifications') app.loadNotifications();
        if (sectionId === 'profile') app.loadProfile('me');
    },

    toast: (msg, isError = false) => {
        const div = document.createElement('div');
        div.style.cssText = `position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: ${isError?'#ff2a2a':'#00d26a'}; color: white; padding: 10px 20px; border-radius: 20px; z-index: 9999; font-weight: bold; font-size: 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);`;
        div.textContent = msg;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 3000);
    },

    showSearch: () => {
        ui.showSection('search');
        document.getElementById('search-input').focus();
    },

    closeChat: () => {
        document.getElementById('chat-view').classList.add('hidden');
        state.activeChatId = null;
        app.loadConversations(); // Rafraichir la liste
    },

    previewVideo: () => {
        const file = document.getElementById('video-file').files[0];
        if(file) {
            document.getElementById('video-preview-container').classList.remove('hidden');
            document.getElementById('file-name').textContent = `Fichier: ${file.name} (${(file.size/1024/1024).toFixed(1)} MB)`;
        }
    }
};

// --- LOGIQUE APPLICATIVE (APP) ---
const app = {
    init: () => {
        if (state.token) {
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('app-screen').classList.remove('hidden');
            app.connectWS();
            ui.showSection('feed');
            app.loadNotifications(); // Pour le badge
        } else {
            document.getElementById('auth-screen').classList.remove('hidden');
        }
        document.getElementById('loader-screen').classList.add('hidden');
    },

    // --- AUTHENTIFICATION ---
    login: async () => {
        const u = document.getElementById('login-user').value;
        const p = document.getElementById('login-pass').value;
        if(!u || !p) return ui.toast('Remplissez tout', true);

        try {
            const fd = new URLSearchParams(); fd.append('username', u); fd.append('password', p);
            const res = await fetch(`${API_URL}/token`, { method: 'POST', body: fd });
            if(!res.ok) throw new Error();
            const data = await res.json();
            
            localStorage.setItem('token', data.access_token);
            localStorage.setItem('user', JSON.stringify({id: data.user_id, username: data.username}));
            location.reload();
        } catch(e) { ui.toast('Erreur de connexion', true); }
    },

    register: async () => {
        const u = document.getElementById('reg-user').value;
        const p = document.getElementById('reg-pass').value;
        const e = document.getElementById('reg-email').value;
        
        try {
            const res = await fetch(`${API_URL}/api/users/register`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: u, password: p, email: e || null})
            });
            if(!res.ok) throw new Error((await res.json()).detail || 'Erreur');
            ui.toast('Compte créé ! Connectez-vous.');
            ui.toggleAuth('login');
        } catch(err) { ui.toast(err.message, true); }
    },

    logout: () => {
        localStorage.clear();
        location.reload();
    },

    // --- FEED & VIDÉOS ---
    loadFeed: async () => {
        const container = document.getElementById('feed-container');
        if(container.children.length > 0) return; // Évite rechargement inutile
        
        try {
            document.getElementById('feed-loader').classList.remove('hidden');
            const res = await fetch(`${API_URL}/api/feed`, { headers: {'Authorization': `Bearer ${state.token}`} });
            const videos = await res.json();
            document.getElementById('feed-loader').classList.add('hidden');

            container.innerHTML = videos.map(v => `
                <div class="video-card">
                    <video class="video-player" controls poster="${v.thumbnail_url}" playsinline>
                        <source src="${v.video_url}" type="video/mp4">
                    </video>
                    <div class="video-info">
                        <strong>@${v.username}</strong>
                        <p>${v.description}</p>
                        <div class="video-stats">
                            <span>❤️ ${v.likes}</span>
                            <span>👁️ ${v.views}</span>
                            <span>📅 ${new Date(v.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        } catch(e) { console.error(e); }
    },

    // --- UPLOAD ---
    uploadVideo: async () => {
        const file = document.getElementById('video-file').files[0];
        const desc = document.getElementById('video-desc').value;
        if(!file) return ui.toast('Sélectionnez une vidéo', true);

        const btn = document.getElementById('btn-upload');
        btn.disabled = true;
        btn.textContent = "Publication en cours... (Patientez)";

        const fd = new FormData();
        fd.append('video', file);
        fd.append('description', desc);
        fd.append('is_public', document.getElementById('video-public').checked);

        try {
            const res = await fetch(`${API_URL}/api/videos/upload`, {
                method: 'POST',
                headers: {'Authorization': `Bearer ${state.token}`},
                body: fd
            });
            if(!res.ok) throw new Error('Fichier trop lourd ou erreur serveur');
            
            ui.toast('Vidéo publiée avec succès !');
            document.getElementById('video-file').value = '';
            document.getElementById('video-desc').value = '';
            ui.showSection('feed');
            app.loadFeed(); // Recharger le feed
        } catch(e) { 
            ui.toast(e.message, true); 
        } finally {
            btn.disabled = false;
            btn.textContent = "Publier";
        }
    },

    // --- CHAT & WEBSOCKET ---
    connectWS: () => {
        if(!state.user) return;
        state.socket = new WebSocket(`${WS_URL}/${state.user.id}`);
        
        state.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'new_message') {
                if (state.activeChatId === data.sender_id) {
                    app.appendMessage(data, 'received');
                } else {
                    ui.toast(`Message de ${data.sender_username}`);
                    app.loadNotifications();
                }
            } else if (data.type === 'notification') {
                app.loadNotifications();
            }
        };
        
        state.socket.onclose = () => setTimeout(app.connectWS, 3000); // Reconnexion auto
    },

    loadConversations: async () => {
        const res = await fetch(`${API_URL}/api/messages/conversations`, { headers: {'Authorization': `Bearer ${state.token}`} });
        const convs = await res.json();
        
        document.getElementById('conversations-list').innerHTML = convs.map(c => `
            <div class="user-row" onclick="app.openChat('${c.user_id}', '${c.username}')" style="padding: 15px; cursor:pointer;">
                <img src="${c.avatar_url || 'https://via.placeholder.com/50'}" class="avatar-circle">
                <div style="flex:1">
                    <div style="font-weight:bold; display:flex; justify-content:space-between;">
                        ${c.username}
                        ${c.is_online ? '<span style="color:#00d26a; font-size:0.8rem">●</span>' : ''}
                    </div>
                    <div style="color:#888; font-size:0.9rem;">
                        ${c.unread_count > 0 ? `<b>${c.last_message} (${c.unread_count})</b>` : c.last_message}
                    </div>
                </div>
            </div>
        `).join('');
    },

    openChat: async (userId, username) => {
        state.activeChatId = userId;
        document.getElementById('chat-target-username').textContent = username;
        document.getElementById('chat-view').classList.remove('hidden');
        document.getElementById('messages-container').innerHTML = '<div class="spinner small"></div>';
        
        const res = await fetch(`${API_URL}/api/messages/${userId}?limit=50`, { headers: {'Authorization': `Bearer ${state.token}`} });
        const msgs = await res.json();
        
        const container = document.getElementById('messages-container');
        container.innerHTML = '';
        msgs.forEach(m => app.appendMessage(m, m.sender_id === state.user.id ? 'sent' : 'received'));
        app.scrollToBottom();
    },

    sendMessage: async () => {
        const input = document.getElementById('msg-input');
        const txt = input.value.trim();
        if(!txt || !state.activeChatId) return;

        // Envoi optimiste (affichage immédiat)
        app.appendMessage({content: txt}, 'sent');
        input.value = '';
        app.scrollToBottom();

        try {
            await fetch(`${API_URL}/api/messages/send`, {
                method: 'POST',
                headers: {'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json'},
                body: JSON.stringify({receiver_id: state.activeChatId, content: txt})
            });
        } catch(e) { ui.toast('Erreur envoi', true); }
    },

    appendMessage: (msg, type) => {
        const div = document.createElement('div');
        div.className = `msg ${type}`;
        div.textContent = msg.content;
        document.getElementById('messages-container').appendChild(div);
        app.scrollToBottom();
    },

    scrollToBottom: () => {
        const c = document.getElementById('messages-container');
        c.scrollTop = c.scrollHeight;
    },

    // --- LIVES ---
    startLiveConfig: async () => {
        const title = prompt("Titre du live ?");
        if(!title) return;
        
        try {
            const res = await fetch(`${API_URL}/api/lives/start`, {
                method: 'POST',
                headers: {'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json'},
                body: JSON.stringify({title: title, is_private: false})
            });
            const data = await res.json();
            
            document.getElementById('stream-key-display').value = data.stream_key;
            document.getElementById('live-modal').classList.remove('hidden');
            app.loadLives();
        } catch(e) { ui.toast('Erreur création live', true); }
    },

    loadLives: async () => {
        const res = await fetch(`${API_URL}/api/lives/active`, { headers: {'Authorization': `Bearer ${state.token}`} });
        const lives = await res.json();
        const container = document.getElementById('lives-container');
        
        if(lives.length === 0) {
            container.innerHTML = '<p style="text-align:center; padding:20px; color:#666">Aucun live en cours</p>';
            return;
        }

        container.innerHTML = lives.map(l => `
            <div class="video-card">
                <div style="background:black; height:200px; display:flex; align-items:center; justify-content:center; color:white;">
                    🔴 LIVE - ${l.viewer_count} spectateurs
                </div>
                <div class="video-info">
                    <strong>${l.title}</strong> par ${l.username}
                </div>
            </div>
        `).join('');
    },

    // --- RECHERCHE ---
    search: async (query) => {
        if(query.length < 2) return;
        const res = await fetch(`${API_URL}/api/search?q=${query}&type=users`, { headers: {'Authorization': `Bearer ${state.token}`} });
        const users = await res.json();
        
        document.getElementById('search-results').innerHTML = users.map(u => `
            <div class="user-row" onclick="app.visitProfile('${u.id}')">
                <img src="${u.avatar_url || 'https://via.placeholder.com/40'}" class="avatar-circle">
                <div>
                    <strong>${u.username}</strong>
                    <div style="font-size:0.8rem; color:#888">${u.bio || ''}</div>
                </div>
            </div>
        `).join('');
    },

    // --- NOTIFICATIONS ---
    loadNotifications: async () => {
        const res = await fetch(`${API_URL}/api/notifications?limit=20`, { headers: {'Authorization': `Bearer ${state.token}`} });
        const notifs = await res.json();
        
        // Update badge
        const unread = notifs.filter(n => !n.read).length;
        const badge = document.getElementById('notif-count');
        badge.textContent = unread;
        badge.classList.toggle('hidden', unread === 0);

        document.getElementById('notif-list').innerHTML = notifs.map(n => `
            <div class="user-row" style="opacity: ${n.read ? 0.5 : 1}">
                <img src="${n.from_avatar || 'https://via.placeholder.com/40'}" class="avatar-circle">
                <div>
                    <div>${n.message}</div>
                    <small style="color:#666">${new Date(n.created_at).toLocaleTimeString()}</small>
                </div>
            </div>
        `).join('');
        
        // Mark all as read after opening
        if(unread > 0 && document.getElementById('notifications-section').classList.contains('active-section')) {
            fetch(`${API_URL}/api/notifications/read-all`, { method:'POST', headers: {'Authorization': `Bearer ${state.token}`} });
        }
    },
    
    // --- PROFILE ---
    loadProfile: async (userId) => {
        const url = userId === 'me' ? `${API_URL}/api/users/me` : `${API_URL}/api/users/${userId}`;
        const res = await fetch(url, { headers: {'Authorization': `Bearer ${state.token}`} });
        const p = await res.json();
        
        let html = `
            <div style="text-align:center; padding:20px;">
                <img src="${p.avatar_url || 'https://via.placeholder.com/100'}" style="width:100px; height:100px; border-radius:50%; border:2px solid var(--primary);">
                <h2 class="mt-20">@${p.username}</h2>
                <p>${p.bio || 'Pas de bio'}</p>
                <div style="display:flex; justify-content:center; gap:20px; margin:20px 0;">
                    <div><b>${p.followers_count}</b><br><small>Abonnés</small></div>
                    <div><b>${p.following_count}</b><br><small>Suivis</small></div>
                    <div><b>${p.videos_count}</b><br><small>Vidéos</small></div>
                </div>
        `;
        
        if (userId !== 'me' && state.user.id !== p.id) {
            html += `<button onclick="app.follow('${p.id}')" class="btn-primary" style="width:auto; padding:10px 30px;">
                ${p.is_following ? 'Se désabonner' : "S'abonner"}
            </button>`;
        }
        
        html += `</div>`;
        document.getElementById('profile-content').innerHTML = html;
    },
    
    follow: async (id) => {
        await fetch(`${API_URL}/api/users/${id}/follow`, { method: 'POST', headers: {'Authorization': `Bearer ${state.token}`} });
        app.loadProfile(id); // Reload to update button
    },
    
    visitProfile: (id) => {
        ui.showSection('profile');
        app.loadProfile(id);
    }
};

// Démarrage
document.addEventListener('DOMContentLoaded', app.init);
