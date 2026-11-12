
const fetch = require('node-fetch');
const fs = require('fs');

// =====================================
// CONFIGURATION
// =====================================

const FIREBASE_DB_URL =
    "https://ipl2020-46d2f.firebaseio.com/Prmovies.json";

const TARGET_PATH = "release-year/2026/";

const GROUP_NAME = "✨New Movies";

const WORKER_URL =
    "https://bold-darkness-d959.poonamchouhan076.workers.dev/";

const STREAM_DOMAINS = [
    "https://speedostream1.com/",
    "https://speedostream.com/"
];

const PLAYLIST_FILE = "playlist.m3u";
const TEMP_FILE = "playlist.m3u.tmp";

const MAX_PAGES = 3;
const REQUEST_TIMEOUT = 10000;
const RETRIES = 2;

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0"
];

// =====================================
// HELPERS
// =====================================

function getRandomUserAgent() {
    return USER_AGENTS[
        Math.floor(Math.random() * USER_AGENTS.length)
    ];
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retries = RETRIES) {

    for (let i = 0; i < retries; i++) {

        let controller;
        let timeoutId;

        try {

            controller = new AbortController();

            timeoutId = setTimeout(
                () => controller.abort(),
                REQUEST_TIMEOUT
            );

            const response = await fetch(url, {
                ...options,

                headers: {
                    "User-Agent": getRandomUserAgent(),
                    ...(options.headers || {})
                },

                signal: controller.signal
            });

            if (response.ok) {
                return response;
            }

            console.log(
                `HTTP ${response.status}: ${url}`
            );

        } catch (error) {

            console.log(
                `Request attempt ${i + 1} failed: ${error.message}`
            );

        } finally {

            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }

        if (i < retries - 1) {
            await sleep(1000);
        }
    }

    return null;
}

// =====================================
// FIREBASE DOMAIN
// =====================================

async function getMainDomainFromFirebase() {

    console.log("Fetching domain from Firebase...");

    const response = await fetchWithRetry(
        FIREBASE_DB_URL,
        {},
        RETRIES
    );

    if (!response) {
        throw new Error("Firebase connection failed!");
    }

    const data = await response.json();

    if (!data || !data.Domain) {
        throw new Error(
            "Firebase Domain key not found!"
        );
    }

    let domain = data.Domain.toString().trim();

    if (!/^https?:\/\//i.test(domain)) {
        domain = "https://" + domain;
    }

    const parsed = new URL(domain);

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Invalid Firebase domain!");
    }

    if (!domain.endsWith("/")) {
        domain += "/";
    }

    console.log("Firebase Domain:", domain);

    return domain;
}

// =====================================
// STREAM DOMAIN CHECK
// =====================================

async function getLiveDomain() {

    console.log("Checking stream domain...");

    for (const domain of STREAM_DOMAINS) {

        const response = await fetchWithRetry(
            domain,
            { method: "HEAD" },
            1
        );

        if (response) {

            try {

                const liveDomain =
                    new URL(response.url).origin + "/";

                console.log(
                    "Stream domain found:",
                    liveDomain
                );

                return liveDomain;

            } catch (error) {}
        }
    }

    console.log(
        "Stream domain check failed. Using default."
    );

    return STREAM_DOMAINS[0];
}

// =====================================
// HTML HELPERS
// =====================================

function cleanText(value) {

    return value
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function escapeAttribute(value) {

    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/\r?\n/g, " ");
}

// =====================================
// BUILD WORKER PAGE URL
// =====================================

function getWorkerPageUrl(categoryUrl, page) {

    const pageUrl = page === 1
        ? categoryUrl
        : new URL(`page/${page}/`, categoryUrl).href;

    const worker = new URL(WORKER_URL);

    worker.searchParams.set("site", pageUrl);

    return worker.href;
}

// =====================================
// MAIN PLAYLIST GENERATOR
// =====================================

async function generatePlaylist() {

    try {

        console.log("================================");
        console.log("PRT PLAYLIST UPDATE STARTED");
        console.log("================================");

        let playlist = "#EXTM3U\n";

        let totalMoviesAdded = 0;

        const addedLinks = new Set();

        // Firebase domain

        const MAIN_SITE =
            await getMainDomainFromFirebase();

        // Stream domain

        const streamBase =
            await getLiveDomain();

        const cleanStreamBase =
            streamBase.replace(/\/+$/, "");

        // Category URL

        const categoryUrl =
            new URL(TARGET_PATH, MAIN_SITE).href;

        console.log("Category:", categoryUrl);

        let emptyPageStreak = 0;

        // =================================
        // PAGE LOOP
        // =================================

        for (
            let page = 1;
            page <= MAX_PAGES;
            page++
        ) {

            console.log(`\nProcessing Page ${page}...`);

            const targetPageUrl =
                getWorkerPageUrl(categoryUrl, page);

            const htmlResponse =
                await fetchWithRetry(targetPageUrl);

            if (!htmlResponse) {

                console.log(
                    `Page ${page} failed.`
                );

                continue;
            }

            const htmlContent =
                await htmlResponse.text();

            if (!htmlContent || !htmlContent.trim()) {

                console.log(
                    `Page ${page} returned empty HTML.`
                );

                emptyPageStreak++;

                if (emptyPageStreak >= 2) break;

                continue;
            }

            // Find movie items

            const mlItems = htmlContent.split(
                /class=["'][^"']*\bml-item\b[^"']*["']/i
            );

            if (mlItems.length <= 1) {

                console.log(
                    `No movies found on page ${page}.`
                );

                emptyPageStreak++;

                if (emptyPageStreak >= 2) break;

                continue;
            }

            emptyPageStreak = 0;

            let pageMovieCount = 0;

            // =================================
            // MOVIE LOOP
            // =================================

            for (
                let index = 1;
                index < mlItems.length;
                index++
            ) {

                const item = mlItems[index];

                const hrefMatch =
                    item.match(
                        /<a\b[^>]*href=["']([^"']+)["']/i
                    );

                const imgMatch =
                    item.match(
                        /data-original=["']([^"']+)["']/i
                    ) ||
                    item.match(
                        /<img\b[^>]*src=["']([^"']+)["']/i
                    );

                const titleMatch =
                    item.match(
                        /<h2[^>]*>([\s\S]*?)<\/h2>/i
                    ) ||
                    item.match(
                        /title=["']([^"']+)["']/i
                    );

                if (!hrefMatch) continue;

                let movieHref;
                let logo = "";
                let title = "Unknown Title";

                try {

                    movieHref =
                        new URL(
                            hrefMatch[1],
                            categoryUrl
                        ).href;

                    if (
                        !["http:", "https:"].includes(
                            new URL(movieHref).protocol
                        )
                    ) {
                        continue;
                    }

                    if (imgMatch) {

                        logo = new URL(
                            imgMatch[1],
                            categoryUrl
                        ).href;
                    }

                    if (titleMatch) {

                        title = cleanText(
                            titleMatch[1]
                        );
                    }

                } catch (error) {

                    console.log(
                        "Invalid movie information."
                    );

                    continue;
                }

                // Fetch detail page

                const detailResponse =
                    await fetchWithRetry(
                        movieHref,
                        {},
                        1
                    );

                if (!detailResponse) {

                    console.log(
                        "Detail page failed:",
                        title
                    );

                    continue;
                }

                const detailHtml =
                    await detailResponse.text();

                // Find iframe

                const iframeMatch =
                    detailHtml.match(
                        /<iframe\b[^>]*src=["']([^"']+)["']/i
                    );

                if (!iframeMatch) continue;

                let iframeUrl;

                try {

                    iframeUrl = new URL(
                        iframeMatch[1],
                        movieHref
                    ).href;

                } catch (error) {

                    continue;
                }

                // Extract embed ID

                const idMatch =
                    iframeUrl.match(
                        /embed-([a-zA-Z0-9]+)\.html/i
                    );

                if (!idMatch) continue;

                const embedId = idMatch[1];

                const playLink =
                    `${cleanStreamBase}/embed-${embedId}.html`;

                // Avoid duplicate links

                if (addedLinks.has(playLink)) {
                    continue;
                }

                addedLinks.add(playLink);

                // Add to playlist

                playlist +=
                    `#EXTINF:-1 tvg-logo="${escapeAttribute(logo)}" group-title="${escapeAttribute(GROUP_NAME)}",${cleanText(title)}\n`;

                playlist += playLink + "\n";

                totalMoviesAdded++;

                pageMovieCount++;

                console.log(
                    `Added: ${title}`
                );
            }

            console.log(
                `Page ${page}: ${pageMovieCount} movies added.`
            );
        }

        // =================================
        // FINAL VALIDATION
        // =================================

        console.log("\n================================");

        console.log(
            "Total Movies:",
            totalMoviesAdded
        );

        if (totalMoviesAdded === 0) {

            throw new Error(
                "No movies found. Old playlist preserved!"
            );
        }

        // =================================
        // ATOMIC FILE WRITE
        // =================================

        fs.writeFileSync(
            TEMP_FILE,
            playlist,
            "utf8"
        );

        fs.renameSync(
            TEMP_FILE,
            PLAYLIST_FILE
        );

        console.log(
            "Playlist successfully updated!"
        );

        console.log(
            "Saved:",
            PLAYLIST_FILE
        );

        console.log("================================");

    } catch (error) {

        // Remove incomplete temporary file

        if (fs.existsSync(TEMP_FILE)) {

            fs.unlinkSync(TEMP_FILE);
        }

        console.error(
            "\nPLAYLIST UPDATE FAILED:",
            error
        );

        // GitHub Actions must show failure

        process.exitCode = 1;
    }
}

// =====================================
// START
// =====================================

generatePlaylist();
