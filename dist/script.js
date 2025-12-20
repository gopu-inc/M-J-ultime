// CONFIGURATION
const API_URL = "https://mj-hub.onrender.com";
const WS_URL = "wss://mj-hub.onrender.com/ws"; // WebSocket Secure

// ETAT DE L'APPLICATION
const state = {
    token: localStorage.getItem('mj_token'),
    user: JSON.parse(localStorage.getItem('mj_user') || '{}'),
    activeChat: null,
    socket: null
};

// GESTION UI
const ui = {
    toggleAuth: (mode) => {
        if(mode === 'register') {
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.remove('hidden');
        } else {
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        }
    },

    showSection: (sectionId) => {
        // Active Navigation
        document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
        event.currentTarget.classList.add('active');

        // Affiche Section
        document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
        document.getElementById(`${sectionId}-section`).classList.add('active');
        document.getElementById('page-title').innerText = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);

        // Charge les données
        if(sectionId === 'dashboard') app.loadStats();
        if(sectionId === 'feed') app.loadFeed();
        if(sectionId === 'chat') app.loadConversations();
        if(sectionId === 'profile') app.loadProfile();
    },

    toast: (msg, type = 'info') => {
        const div = document.createElement('div');
        div.className = `toast ${type}`;
        div.innerText = msg;
        document.getElementById('toast-container').appendChild(div);
        setTimeout(() => div.remove(), 3000);
    }
};

// LOGIQUE PRINCIPALE
const app = {
    init: () => {
        if(state.token) {
            document.getElementById('auth-screen').classList.remove('active');
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('app-screen').classList.remove('hidden');
            document.getElementById('app-screen').classList.add('active');
            document.getElementById('current-username').innerText = state.user.username;
            app.connectWebSocket();
            app.loadStats();
        }
    },

    // AUTHENTIFICATION
    login: async () => {
        const user = document.getElementById('login-username').value;
        const pass = document.getElementById('login-password').value;

        try {
            const formData = new URLSearchParams();
            formData.append('username', user);
            formData.append('password', pass);

            const res = await fetch(`${API_URL}/token`, {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: formData
            });

            if(!res.ok) throw new Error('Identifiants incorrects');
            
            const data = await res.json();
            localStorage.setItem('mj_token', data.access_token);
            localStorage.setItem('mj_user', JSON.stringify({id: data.user_id, username: data.username}));
            
            state.token = data.access_token;
            state.user = {id: data.user_id, username: data.username};
            
            window.location.reload();
        } catch (e) {
            ui.toast(e.message, 'error');
        }
    },

    register: async () => {
        const user = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const pass = document.getElementById('reg-password').value;

        try {
            const res = await fetch(`${API_URL}/api/users/register`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: user, password: pass, email: email || null})
            });

            if(!res.ok) throw new Error("Erreur inscription");
            ui.toast("Compte créé ! Connectez-vous.", "success");
            ui.toggleAuth('login');
        } catch (e) {
            ui.toast(e.message, 'error');
        }
    },

    logout: () => {
        localStorage.clear();
        window.location.reload();
    },

    // DATA FETCHING
    loadStats: async () => {
        const res = await fetch(`${API_URL}/api/stats`, {
            headers: {'Authorization': `Bearer ${state.token}`}
        });
        const data = await res.json();
        document.getElementById('stat-online').innerText = data.online_users;
        document.getElementById('stat-videos').innerText = data.total_videos;
        document.getElementById('stat-lives').innerText = data.active_lives;
    },

    loadFeed: async () => {
        const container = document.getElementById('video-grid');
        try {
            const res = await fetch(`${API_URL}/api/feed`, {
                headers: {'Authorization': `Bearer ${state.token}`}
            });
            const videos = await res.json();
            
            container.innerHTML = videos.map(v => `
                <div class="video-card">
                    <img src="${v.thumbnail_url || 'https://via.placeholder.com/300x180'}" class="thumbnail">
                    <div class="video-info">
                        <h4>${v.description || 'Vidéo sans titre'}</h4>
                        <p><small>@${v.username}</small></p>
                        <p>❤️ ${v.likes} • 👁️ ${v.views}</p>
                    </div>
                </div>
            `).join('');
        } catch(e) { container.innerHTML = "Erreur chargement feed"; }
    },

    loadProfile: async () => {
        const res = await fetch(`${API_URL}/api/users/me`, {
            headers: {'Authorization': `Bearer ${state.token}`}
        });
        const data = await res.json();
        document.getElementById('profile-card').innerHTML = `
            <img src="${data.avatar_url || 'https://via.placeholder.com/100'}" class="profile-avatar">
            <h2>${data.username}</h2>
            <p>${data.bio || 'Pas de bio'}</p>
            <br>
            <div style="display:flex; justify-content:space-around;">
                <div><strong>${data.followers_count}</strong><br>Abonnés</div>
                <div><strong>${data.following_count}</strong><br>Abonnements</div>
            </div>
        `;
    },

    // CHAT & WEBSOCKET
    connectWebSocket: () => {
        state.socket = new WebSocket(`${WS_URL}/${state.user.id}`);
        state.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if(data.type === 'new_message' && state.activeChat === data.sender_id) {
                app.renderMessage(data, 'received');
            } else if (data.type === 'new_message') {
                ui.toast(`Nouveau message de ${data.sender_username}`);
            }
        };
    },

    loadConversations: async () => {
        const res = await fetch(`${API_URL}/api/messages/conversations`, {
            headers: {'Authorization': `Bearer ${state.token}`}
        });
        const convs = await res.json();
        const list = document.getElementById('conversations-list');
        list.innerHTML = convs.map(c => `
            <div class="conversation-item" onclick="app.openChat('${c.user_id}', '${c.username}')">
                <div class="status-dot ${c.is_online ? 'online' : ''}"></div>
                <strong>${c.username}</strong>
                ${c.unread_count > 0 ? `<span style="background:red;padding:2px 6px;border-radius:10px;font-size:0.8rem">${c.unread_count}</span>` : ''}
            </div>
        `).join('');
    },

    openChat: async (userId, username) => {
        state.activeChat = userId;
        document.getElementById('chat-placeholder').classList.add('hidden');
        document.getElementById('chat-active').classList.remove('hidden');
        document.getElementById('chat-target-name').innerText = username;
        
        const res = await fetch(`${API_URL}/api/messages/${userId}`, {
            headers: {'Authorization': `Bearer ${state.token}`}
        });
        const messages = await res.json();
        const area = document.getElementById('messages-area');
        area.innerHTML = '';
        messages.forEach(m => {
            app.renderMessage(m, m.sender_id === state.user.id ? 'sent' : 'received');
        });
        area.scrollTop = area.scrollHeight;
    },

    sendMessage: async () => {
        const input = document.getElementById('message-input');
        const content = input.value;
        if(!content) return;

        state.socket.send(JSON.stringify({
            type: 'message',
            receiver_id: state.activeChat,
            content: content,
            sender_username: state.user.username
        }));

        app.renderMessage({content: content}, 'sent');
        input.value = '';
        
        // Optionnel : Sauvegarder via API si le WS ne gère pas la DB directement (selon backend)
        // Mais ton backend Python WS gère l'insert DB, donc c'est bon.
    },

    renderMessage: (msg, type) => {
        const div = document.createElement('div');
        div.className = `message ${type}`;
        div.innerText = msg.content;
        const area = document.getElementById('messages-area');
        area.appendChild(div);
        area.scrollTop = area.scrollHeight;
    }
};

// Start
app.init();
