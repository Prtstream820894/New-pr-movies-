const fetch = require('node-fetch');
const fs = require('fs');

// --- 🌐 CONFIGURATION ---
// Firebase Realtime Database URL (Sahi path ke sath)
const FIREBASE_DB_URL = "https://ipl2020-46d2f.firebaseio.com/Prmovies.json";

// Sirf ek hi link/path yahan dalein jise aapko scrape karna hai
const TARGET_PATH = "release-year/2026/"; 

// Yahan aap apna group name rakh sakte hain jo M3U playlist mein show hoga
const GROUP_NAME = "✨New Movies"; 

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0"
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithRetry(url, options = {}, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 7000);
            
            const res = await fetch(url, {
                ...options,
                headers: { "User-Agent": getRandomUserAgent(), ...(options.headers || {}) },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) return res;
        } catch (e) {
            if (i === retries - 1) return null;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    return null;
}

// Firebase se sahi JSON structure parse karke domain nikalne ke liye function
async function getMainDomainFromFirebase() {
    console.log("Fetching main domain strictly from Firebase...");
    const res = await fetchWithRetry(FIREBASE_DB_URL, {}, 2);
    if (!res) {
        throw new Error("❌ Error: Firebase se connect nahi ho paya ya domain fetch nahi hua!");
    }
    
    const data = await res.json();
    if (!data || !data.Domain) {
        throw new Error("❌ Error: Firebase response mein 'Domain' key nahi mili!");
    }

    let domain = data.Domain.toString().trim();
    console.log(`-> Domain fetched successfully from Firebase: ${domain}`);
    return domain.endsWith('/') ? domain : domain + '/';
}

async function getLiveDomain(testUrls) {
    for (let url of testUrls) {
        try {
            const res = await fetchWithRetry(url, { method: 'HEAD' }, 1);
            if (res && res.ok) return new URL(res.url).origin + "/";
        } catch (e) {}
    }
    return testUrls[0];
}

async function generatePlaylist() {
    try {
        let playlist = "#EXTM3U\n";
        let totalMoviesAdded = 0;
        
        // Firebase se dynamic main site URL lena
        const MAIN_SITE = await getMainDomainFromFirebase();

        console.log("Fetching live stream base domain...");
        const streamBaseLive = await getLiveDomain(["https://speedostream1.com/", "https://speedostream.com/"]);
        const cleanStreamBase = streamBaseLive.replace(/\/$/, "");

        const catBaseUrl = new URL(TARGET_PATH, MAIN_SITE).href;
        console.log(`\n--- Processing Target Link: ${catBaseUrl} [Group: ${GROUP_NAME}] ---`);
        
        let emptyPageStreak = 0;

        for (let p = 1; p <= 3; p++) { 
            let targetPageUrl = p === 1 
                ? `https://bold-darkness-d959.poonamchouhan076.workers.dev/?site=${catBaseUrl}`
                : `https://bold-darkness-d959.poonamchouhan076.workers.dev/?site=${catBaseUrl}page/${p}/`;

            const htmlRes = await fetchWithRetry(targetPageUrl);
            if (!htmlRes) {
                console.log(`  -> Page ${p}: Failed to load, trying next page...`);
                continue;
            }

            const htmlContent = await htmlRes.text();
            const mlItems = htmlContent.split('class="ml-item"');

            if (mlItems.length <= 1) {
                emptyPageStreak++;
                if (emptyPageStreak >= 2) break;
                continue;
            }

            emptyPageStreak = 0;
            let pageMovieCount = 0;

            for (let index = 1; index < mlItems.length; index++) {
                const item = mlItems[index];

                const hrefMatch = item.match(/<a\s+href="([^"]+)"/) || item.match(/href="([^"]+\/(?:movie|series|item)\/[^"]+)"/);
                const imgMatch = item.match(/data-original="([^"]+)"/) || item.match(/src="([^"]+)"/);
                const titleMatch = item.match(/<h2>([\s\S]*?)<\/h2>/) || item.match(/title="([^"]+)"/);

                if (!hrefMatch) continue;

                const movieHref = hrefMatch[1];
                let title = titleMatch ? titleMatch[1].replace(/<[^>]*>?/gm, '').trim() : "Unknown Title";
                let logo = imgMatch ? imgMatch[1] : '';

                try {
                    const detailRes = await fetchWithRetry(movieHref, {}, 1);
                    if (!detailRes) continue;

                    const detailHtml = await detailRes.text();
                    const iframeMatch = detailHtml.match(/<iframe[^>]+src="([^"]+)"/i);
                    
                    if (iframeMatch && iframeMatch[1]) {
                        const idMatch = iframeMatch[1].match(/embed-([a-zA-Z0-9]+)\.html/i);
                        if (idMatch && idMatch[1]) {
                            const embedId = idMatch[1];
                            const playLink = `${cleanStreamBase}/embed-${embedId}.html`;
                            
                            playlist += `#EXTINF:-1 tvg-logo="${logo}" group-title="${GROUP_NAME}",${title}\n${playLink}\n`;
                            totalMoviesAdded++;
                            pageMovieCount++;
                        }
                    }
                } catch (err) {}
            }
            console.log(`  -> Page ${p}: Added ${pageMovieCount} movies.`);
        }

        fs.writeFileSync('playlist.m3u', playlist, 'utf-8');
        console.log(`\n✅ Playlist successfully generated! Total items added: ${totalMoviesAdded}. Saved as playlist.m3u`);
    } catch (error) {
        console.error(error.message);
    }
}

generatePlaylist();
