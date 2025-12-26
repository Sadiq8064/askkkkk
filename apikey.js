const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs").promises;
const RAGService = require("./rag");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// DB paths
const DB_DIR = path.join(__dirname, "database");
const STUDENTS_DIR = path.join(DB_DIR, "students");
const UNIVERSITIES_DIR = path.join(DB_DIR, "universities");
const CHAT_DIR = path.join(DB_DIR, "chat_sessions");
const PROVIDER_LOGS_DIR = path.join(DB_DIR, "provider_questions");

// ensure directories
(async () => {
    await fs.mkdir(CHAT_DIR, { recursive: true });
    await fs.mkdir(PROVIDER_LOGS_DIR, { recursive: true });
})();

// -------------------- helpers --------------------
async function readStudent(email) {
    try {
        const safe = email.replace(/[^a-zA-Z0-9@._-]/g, "_");
        const file = path.join(STUDENTS_DIR, safe + ".json");
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
        return null;
    }
}

async function readUniversity(email) {
    try {
        const safe = email.replace(/[^a-zA-Z0-9@._-]/g, "_");
        const file = path.join(UNIVERSITIES_DIR, safe + ".json");
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
        return null;
    }
}

function getSessionFile(email, sessionId) {
    const safeEmail = email.replace(/[^a-zA-Z0-9@._-]/g, "_");
    return path.join(CHAT_DIR, `${safeEmail}__${sessionId}.json`);
}

function generateSessionName(question) {
    if (!question || typeof question !== "string") return "New Session";
    const words = question.trim().split(/\s+/);
    return words.length <= 10 ? question.trim() : words.slice(0, 10).join(" ") + "...";
}

// Append message to session file (async)
async function appendMessageToSessionFile(email, sessionId, messageObj) {
    const file = getSessionFile(email, sessionId);
    try {
        let session = JSON.parse(await fs.readFile(file, "utf8"));
        session.messages = session.messages || [];
        session.messages.push(messageObj);
        session.updatedAt = new Date().toISOString();
        await fs.writeFile(file, JSON.stringify(session, null, 2));
    } catch (err) {
        // if session file missing, create one
        const sessionData = {
            sessionId,
            sessionName: generateSessionName(messageObj.question || ""),
            email,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [messageObj]
        };
        await fs.writeFile(file, JSON.stringify(sessionData, null, 2));
    }
}

// Create session file (called synchronously before responding if new)
async function createSessionFile(email, sessionId, sessionName) {
    const file = getSessionFile(email, sessionId);
    const sessionData = {
        sessionId,
        sessionName,
        email,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
    };
    await fs.writeFile(file, JSON.stringify(sessionData, null, 2));
}

// Provider logs (store which provider/store was asked + question + answer + timestamp)
async function appendProviderLog(providerEmail, logDoc) {
    try {
        const safe = providerEmail.replace(/[^a-zA-Z0-9@._-]/g, "_");
        const file = path.join(PROVIDER_LOGS_DIR, `${safe}.json`);
        let arr = [];
        try {
            arr = JSON.parse(await fs.readFile(file, "utf8"));
            if (!Array.isArray(arr)) arr = [];
        } catch {
            arr = [];
        }
        arr.push(logDoc);
        await fs.writeFile(file, JSON.stringify(arr, null, 2));
    } catch (err) {
        console.error("appendProviderLog error:", err);
    }
}

// ---------------- GEMINI CLASSIFIER (improved system prompt) ----------------
async function classifyStores(geminiKey, stores, question) {
    try {
        console.log("classifyStores called with key:", geminiKey ? "Present" : "Missing");
        console.log("Stores:", stores);
        console.log("Question:", question);

        if (!geminiKey) {
            console.log("No Gemini key, returning all stores");
            // fallback: return all stores with no splitting
            return { stores: stores, split_questions: {}, unanswered: [] };
        }

        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Changed to more common model

        // TIGHT system prompt — explicit JSON only, deterministic, temperature 0
        const SYSTEM_PROMPT = `
You are a strict classifier and splitter. INPUT:
- stores list (names only): ${JSON.stringify(stores)}
- user's question (provided as the user content)

TASK:
1) Decide which of the stores from the list can answer whole or parts of the user's question.
2) If some part belongs to a store, rewrite that part clearly and put it in split_questions under that store name.
3) If a part belongs to multiple stores, include it under all relevant store keys.
4) If a part cannot be answered by any store, include that part in "unanswered" with a short "reason".

OUTPUT REQUIREMENTS (must output only valid JSON, nothing else):
{
  "stores": ["store1","store2"],               // exact store names from the provided list (or empty array)
  "split_questions": {                         // mapping store -> rewritten question part
     "store1": "rewritten part for store1",
     "store2": "rewritten part for store2"
  },
  "unanswered": [                              // list of {text, reason}
     { "text": "original part text", "reason": "why no store can answer" }
  ]
}

If NO store can answer, return:
{
  "stores": [],
  "split_questions": {},
  "unanswered": [{ "text": "<full question>", "reason": "No department can answer this" }]
}

Do NOT return any extra text, commentary, or explanation. Return valid JSON only.
`.trim();

        console.log("Calling Gemini for classification...");
        const result = await model.generateContent({
            contents: question,
            system_instruction: SYSTEM_PROMPT,
            generationConfig: { temperature: 0.0 }
        });

        // extract text safely
        const txt = result.response?.text?.() || (result.candidates && result.candidates[0] && result.candidates[0].text) || "";
        console.log("Classification raw response:", txt.substring(0, 200) + "...");

        if (!txt) {
            console.log("Empty response from classification");
            return { stores: [], split_questions: {}, unanswered: [] };
        }

        // Parse JSON — try direct parse, otherwise extract substring
        const raw = txt.trim();
        try {
            const parsed = JSON.parse(raw);
            console.log("Classification parsed successfully:", parsed);
            return parsed;
        } catch (e) {
            console.log("JSON parse failed, trying substring extraction");
            const start = raw.indexOf("{");
            const end = raw.lastIndexOf("}");
            if (start !== -1 && end !== -1) {
                try {
                    const parsed = JSON.parse(raw.slice(start, end + 1));
                    console.log("Classification parsed after substring extraction:", parsed);
                    return parsed;
                } catch (e2) {
                    console.warn("classifyStores: JSON parse failed after substring:", e2.message);
                }
            }
        }

        // if parse fails, fallback: treat all stores as selected without splitting
        console.log("Classification failed, returning all stores as fallback");
        return { stores: stores, split_questions: {}, unanswered: [] };
    } catch (err) {
        console.error("classifyStores error:", err.message);
        return { stores: stores, split_questions: {}, unanswered: [] };
    }
}

// ---------------- GET /ask ----------------
router.get("/ask", async (req, res) => {
    console.log("=== ASK ENDPOINT CALLED ===");
    console.log("Time:", new Date().toISOString());
    console.log("Query params:", req.query);

    try {
        const { email, question, sessionId, isCampusSearch } = req.query;

        if (!email || !question) {
            console.log("❌ Missing email or question");
            return res.status(400).json({ error: "email & question required" });
        }

        console.log("📧 Student email:", email);
        console.log("❓ Question:", question);
        console.log("🏫 isCampusSearch:", isCampusSearch);

        // Read student data
        const student = await readStudent(email);
        if (!student) {
            console.log("❌ Student not found:", email);
            return res.status(404).json({ error: "Student not found" });
        }

        console.log("✅ Student found");
        console.log("Student university email:", student.universityEmail);

        const accessible = student.accessibleStores || [];
        const storeNames = accessible.map(s => s.storeName);
        console.log("🔍 Accessible stores:", storeNames);

        // Determine if we should do campus search
        const shouldDoCampusSearch = isCampusSearch !== "false" && isCampusSearch !== false;
        console.log("🎯 Should do campus search:", shouldDoCampusSearch);

        // Handle non-campus search (direct Gemini call)
        if (!shouldDoCampusSearch) {
            console.log("🚀 === DIRECT GEMINI MODE ===");

            // Get university and API key
            let university = null;
            try {
                university = await readUniversity(student.universityEmail);
                console.log("🎓 University data:", university ? "Found" : "Not found");
            } catch (uniErr) {
                console.error("Error reading university:", uniErr.message);
            }

            // Try multiple sources for API key
            let geminiKey = university?.apiKeyInfo?.key || null;

            // Fallback to environment variable
            if (!geminiKey && process.env.GEMINI_API_KEY) {
                console.log("Using environment variable API key");
                geminiKey = process.env.GEMINI_API_KEY;
            }

            console.log("🔑 Gemini API key present:", !!geminiKey);
            console.log("🔑 API key preview:", geminiKey ? geminiKey.substring(0, 8) + "..." : "null");

            if (!geminiKey) {
                console.log("❌ No API key available from any source");
                return res.status(400).json({
                    error: "No API key available for Gemini call",
                    details: "Check university API key or set GEMINI_API_KEY environment variable"
                });
            }

            // Initialize Gemini
            const genAI = new GoogleGenerativeAI(geminiKey);

            // Try multiple model names
            const modelsToTry = ["gemini-1.5-flash", "gemini-pro", "models/gemini-1.5-flash"];
            let model = null;
            let modelName = "";

            for (const modelCandidate of modelsToTry) {
                try {
                    model = genAI.getGenerativeModel({ model: modelCandidate });
                    modelName = modelCandidate;
                    console.log(`✅ Using model: ${modelCandidate}`);
                    break;
                } catch (modelErr) {
                    console.log(`❌ Model ${modelCandidate} not available: ${modelErr.message}`);
                }
            }

            if (!model) {
                console.log("❌ No compatible Gemini model found");
                return res.status(400).json({
                    error: "No compatible Gemini model found",
                    availableModels: modelsToTry
                });
            }

            try {
                console.log(`🤖 Calling Gemini API (${modelName}) with question...`);
                const result = await model.generateContent(question);
                console.log("✅ Gemini API call successful");

                const answerText = result.response?.text?.() || "No response from Gemini";
                console.log(`📝 Gemini response length: ${answerText.length} characters`);
                console.log(`📝 First 200 chars: ${answerText.substring(0, 200)}...`);

                // Handle session
                let isNewSession = false;
                let currentSessionId = sessionId;
                if (!currentSessionId) {
                    isNewSession = true;
                    currentSessionId = "session_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
                }
                const sessionName = isNewSession ? generateSessionName(question) : undefined;

                // Respond immediately
                console.log(`📤 Sending response with sessionId: ${currentSessionId}`);
                const response = {
                    sessionId: currentSessionId,
                    answer: answerText,
                    storesUsed: [],
                    grounding: [],
                    isCampusSearch: false,
                    modelUsed: modelName,
                    timestamp: new Date().toISOString()
                };

                res.json(response);

                // Log session asynchronously
                (async () => {
                    try {
                        if (isNewSession) {
                            await createSessionFile(email, currentSessionId, sessionName);
                            console.log(`📁 Created new session: ${currentSessionId}`);
                        }

                        const messageObj = {
                            role: "assistant",
                            question,
                            answer: answerText,
                            storesUsed: [],
                            grounding: [],
                            timestamp: new Date().toISOString(),
                            isCampusSearch: false,
                            method: "direct_gemini",
                            model: modelName
                        };
                        await appendMessageToSessionFile(email, currentSessionId, messageObj);
                        console.log(`💾 Saved message to session: ${currentSessionId}`);
                    } catch (err) {
                        console.error("background log error (direct gemini):", err.message);
                    }
                })();

                return;
            } catch (geminiErr) {
                console.error("=== GEMINI API ERROR ===");
                console.error("Error name:", geminiErr.name);
                console.error("Error message:", geminiErr.message);
                console.error("Error code:", geminiErr.code);

                // Provide specific error messages
                let errorMessage = "Failed to call Gemini API";
                let statusCode = 500;

                if (geminiErr.message?.includes("API key") || geminiErr.message?.includes("auth")) {
                    errorMessage = "Invalid or unauthorized API key";
                    statusCode = 401;
                } else if (geminiErr.message?.includes("quota") || geminiErr.message?.includes("exceeded")) {
                    errorMessage = "API quota exceeded or rate limited";
                    statusCode = 429;
                } else if (geminiErr.message?.includes("network") || geminiErr.message?.includes("connect")) {
                    errorMessage = "Network error connecting to Gemini API";
                    statusCode = 503;
                } else if (geminiErr.message?.includes("model")) {
                    errorMessage = "Gemini model not available";
                    statusCode = 400;
                }

                return res.status(statusCode).json({
                    error: errorMessage,
                    details: geminiErr.message,
                    suggestion: "Check your API key, internet connection, and try a different model if available"
                });
            }
        }

        // ==================== CAMPUS SEARCH MODE ====================
        console.log("🏛️ === CAMPUS SEARCH MODE ===");

        if (storeNames.length === 0) {
            console.log("⚠️ No RAG stores available for student");
            return res.json({
                sessionId: null,
                answer: "No RAG stores available for your account.",
                storesUsed: [],
                grounding: [],
                isCampusSearch: true
            });
        }

        // Get university key
        const university = await readUniversity(student.universityEmail).catch((err) => {
            console.error("Error reading university in campus mode:", err.message);
            return null;
        });

        let geminiKey = university?.apiKeyInfo?.key || null;

        // Fallback to environment variable
        if (!geminiKey && process.env.GEMINI_API_KEY) {
            console.log("Using environment variable API key for campus search");
            geminiKey = process.env.GEMINI_API_KEY;
        }

        console.log("🔑 Campus search API key:", geminiKey ? "Present" : "Missing");

        // Handle session
        let isNewSession = false;
        let currentSessionId = sessionId;
        if (!currentSessionId) {
            isNewSession = true;
            currentSessionId = "session_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
            console.log(`📁 Created new session ID: ${currentSessionId}`);
        }
        const sessionName = isNewSession ? generateSessionName(question) : undefined;

        // 1) Classify stores
        console.log("🔍 Starting store classification...");
        const classification = await classifyStores(geminiKey, storeNames, question);
        const predictedStores = classification.stores || [];
        const splitQuestions = classification.split_questions || {};
        const unanswered = classification.unanswered || [];

        console.log("📊 Classification results:");
        console.log("- Predicted stores:", predictedStores);
        console.log("- Split questions:", Object.keys(splitQuestions).length > 0 ? splitQuestions : "None");
        console.log("- Unanswered parts:", unanswered.length > 0 ? unanswered : "None");

        // If no stores predicted
        if (!predictedStores || predictedStores.length === 0) {
            console.log("⚠️ No stores predicted for question");
            const answerText = "Sorry, none of the departments can answer this.";

            // Respond
            res.json({
                sessionId: currentSessionId,
                answer: answerText,
                storesUsed: [],
                unanswered,
                isCampusSearch: true
            });

            // Log asynchronously
            (async () => {
                try {
                    if (isNewSession) {
                        await createSessionFile(email, currentSessionId, sessionName);
                    }

                    const messageObj = {
                        role: "assistant",
                        question,
                        answer: answerText,
                        storesUsed: [],
                        grounding: [],
                        timestamp: new Date().toISOString(),
                        unresolvedParts: unanswered,
                        isCampusSearch: true,
                        method: "campus_search"
                    };
                    await appendMessageToSessionFile(email, currentSessionId, messageObj);
                    console.log("💾 Saved no-stores response to session");
                } catch (err) {
                    console.error("background log error (no stores):", err.message);
                }
            })();

            return;
        }

        // 2) Call RAG for each predicted store
        console.log("🤖 Starting RAG calls for stores:", predictedStores);
        const ragResults = [];
        const allGrounding = [];

        for (const store of predictedStores) {
            console.log(`🔍 Processing store: ${store}`);
            const qForStore = splitQuestions[store] || question;
            console.log(`   Question for store: ${qForStore}`);

            try {
                const ragResp = await RAGService.askQuestion(geminiKey, [store], qForStore);

                if (!ragResp || !ragResp.success || !ragResp.data) {
                    console.log(`❌ RAG failed for store: ${store}`);
                    const dept = accessible.find(x => x.storeName === store);
                    const answerText = "Sorry we didn't find any information related to this.";

                    // Respond with error for this store
                    res.json({
                        sessionId: currentSessionId,
                        answer: answerText,
                        searchedIn: dept?.accountEmail || null,
                        isCampusSearch: true,
                        failedStore: store
                    });

                    // Log asynchronously
                    (async () => {
                        try {
                            if (isNewSession) {
                                await createSessionFile(email, currentSessionId, sessionName);
                            }

                            const messageObj = {
                                role: "assistant",
                                question,
                                answer: answerText,
                                storesUsed: [store],
                                grounding: [],
                                timestamp: new Date().toISOString(),
                                searchedIn: dept?.accountEmail || null,
                                isCampusSearch: true,
                                method: "campus_search",
                                ragError: true
                            };
                            await appendMessageToSessionFile(email, currentSessionId, messageObj);

                            // Provider log
                            if (dept?.accountEmail) {
                                await appendProviderLog(dept.accountEmail, {
                                    provider_email: dept.accountEmail,
                                    user_email: email,
                                    store_name: store,
                                    question: qForStore,
                                    response: null,
                                    asked_at: new Date().toISOString(),
                                    isCampusSearch: true,
                                    error: "RAG call failed"
                                });
                            }
                        } catch (err) {
                            console.error("background log error (rag failed):", err.message);
                        }
                    })();

                    return;
                }

                // Successful RAG response
                const answerText = ragResp.data.response_text || "";
                const groundingChunks = ragResp.data.grounding_metadata?.groundingChunks || [];
                ragResults.push({ store, answerText, groundingChunks });

                console.log(`✅ RAG successful for ${store}`);
                console.log(`   Answer length: ${answerText.length} chars`);
                console.log(`   Grounding chunks: ${groundingChunks.length}`);

                // Collect grounding texts
                for (const chunk of groundingChunks || []) {
                    const ctx = chunk.retrievedContext || {};
                    if (ctx.text) allGrounding.push(ctx.text);
                }

            } catch (ragErr) {
                console.error(`❌ RAG error for store ${store}:`, ragErr.message);
                ragResults.push({
                    store,
                    answerText: `Error processing ${store}: ${ragErr.message}`,
                    groundingChunks: []
                });
            }
        }

        // 3) Merge results
        console.log("🔄 Merging RAG results...");
        let finalAnswer;
        if (ragResults.length === 1) {
            finalAnswer = ragResults[0].answerText;
        } else {
            finalAnswer = ragResults.map(r => `**${r.store}**:\n${r.answerText}`).join("\n\n");
        }

        console.log(`📝 Final answer length: ${finalAnswer.length} chars`);

        // 4) Respond immediately
        const response = {
            sessionId: currentSessionId,
            answer: finalAnswer,
            storesUsed: predictedStores,
            grounding: allGrounding.slice(0, 10), // Limit for response
            isCampusSearch: true,
            totalGrounding: allGrounding.length,
            timestamp: new Date().toISOString()
        };

        console.log("📤 Sending campus search response");
        res.json(response);

        // 5) Log asynchronously
        (async () => {
            try {
                if (isNewSession) {
                    await createSessionFile(email, currentSessionId, sessionName);
                    console.log(`📁 Created session file: ${currentSessionId}`);
                }

                // Save assistant message
                const messageObj = {
                    role: "assistant",
                    question,
                    answer: finalAnswer,
                    storesUsed: predictedStores,
                    grounding: allGrounding,
                    timestamp: new Date().toISOString(),
                    isCampusSearch: true,
                    method: "campus_search",
                    ragResultCount: ragResults.length
                };
                await appendMessageToSessionFile(email, currentSessionId, messageObj);
                console.log(`💾 Saved message to session: ${currentSessionId}`);

                // Save provider logs
                for (const r of ragResults) {
                    const store = r.store;
                    const dept = accessible.find(x => x.storeName === store);
                    const providerEmail = dept?.accountEmail || null;
                    const qForStore = splitQuestions[store] || question;

                    await appendProviderLog(providerEmail || "unknown", {
                        provider_email: providerEmail,
                        user_email: email,
                        store_name: store,
                        question: qForStore,
                        response: r.answerText.substring(0, 500) + "...", // Truncate for logs
                        grounding_count: r.groundingChunks.length,
                        asked_at: new Date().toISOString(),
                        isCampusSearch: true
                    });
                }
                console.log(`📊 Saved ${ragResults.length} provider logs`);
            } catch (err) {
                console.error("background persistence error:", err.message);
            }
        })();

    } catch (err) {
        console.error("=== UNEXPECTED ASK ENDPOINT ERROR ===");
        console.error("Error:", err.message);
        console.error("Stack:", err.stack);

        if (!res.headersSent) {
            return res.status(500).json({
                error: "Internal Server Error",
                details: err.message,
                timestamp: new Date().toISOString()
            });
        } else {
            console.error("Response already sent, cannot send error");
        }
    }
});

// ------------------------- GET ALL SESSIONS -------------------------
router.get("/sessions/:email", async (req, res) => {
    try {
        console.log("📋 Getting sessions for:", req.params.email);
        const { email } = req.params;
        const safePrefix = email.replace(/[^a-zA-Z0-9@._-]/g, "_");
        const files = await fs.readdir(CHAT_DIR);
        const sessions = [];

        for (const file of files) {
            if (file.startsWith(safePrefix + "__")) {
                try {
                    const data = JSON.parse(await fs.readFile(path.join(CHAT_DIR, file), "utf8"));
                    sessions.push({
                        sessionId: data.sessionId,
                        sessionName: data.sessionName,
                        createdAt: data.createdAt,
                        messageCount: data.messages?.length || 0
                    });
                } catch { /* skip invalid */ }
            }
        }
        // sort newest first
        sessions.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
        console.log(`📋 Found ${sessions.length} sessions for ${email}`);
        res.json({ sessions });
    } catch (err) {
        console.error("sessions list err:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ----------------------- GET SPECIFIC SESSION -----------------------
router.get("/session/:email/:sessionId", async (req, res) => {
    try {
        const { email, sessionId } = req.params;
        console.log(`📖 Getting session ${sessionId} for ${email}`);
        const file = getSessionFile(email, sessionId);
        const data = JSON.parse(await fs.readFile(file, "utf8"));
        console.log(`📖 Session found with ${data.messages?.length || 0} messages`);
        res.json(data);
    } catch (err) {
        console.error("Get session error:", err.message);
        res.status(404).json({ error: "Session not found" });
    }
});

// ----------------------- DELETE SESSION -----------------------
router.get("/session/delete/:email/:sessionId", async (req, res) => {
    try {
        const { email, sessionId } = req.params;
        console.log(`🗑️ Deleting session ${sessionId} for ${email}`);
        const file = getSessionFile(email, sessionId);

        await fs.access(file);
        await fs.unlink(file);

        console.log(`✅ Session deleted: ${sessionId}`);
        res.json({
            message: "Session deleted successfully",
            email,
            sessionId
        });
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log(`❌ Session not found: ${req.params.sessionId}`);
            res.status(404).json({ error: "Session not found" });
        } else {
            console.error("Delete session error:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
});

// ----------------------- DELETE ALL SESSIONS FOR USER -----------------------
router.get("/sessions/delete/all/:email", async (req, res) => {
    try {
        const { email } = req.params;
        console.log(`🗑️ Deleting all sessions for: ${email}`);
        const safePrefix = email.replace(/[^a-zA-Z0-9@._-]/g, "_");
        const files = await fs.readdir(CHAT_DIR);
        let deletedCount = 0;

        for (const file of files) {
            if (file.startsWith(safePrefix + "__")) {
                try {
                    await fs.unlink(path.join(CHAT_DIR, file));
                    deletedCount++;
                    console.log(`   Deleted: ${file}`);
                } catch { /* skip errors */ }
            }
        }

        console.log(`✅ Deleted ${deletedCount} sessions for ${email}`);
        res.json({
            message: `Deleted ${deletedCount} sessions for user`,
            email,
            deletedCount
        });
    } catch (err) {
        console.error("Delete all sessions error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ----------------------- GET PROVIDER LOGS -----------------------
router.get("/provider/logs/:providerEmail", async (req, res) => {
    try {
        const { providerEmail } = req.params;
        const { limit } = req.query;
        console.log(`📊 Getting logs for provider: ${providerEmail}`);

        const safeEmail = providerEmail.replace(/[^a-zA-Z0-9@._-]/g, "_");
        const file = path.join(PROVIDER_LOGS_DIR, `${safeEmail}.json`);

        try {
            const data = JSON.parse(await fs.readFile(file, "utf8"));
            let logs = data;

            // Sort by most recent first
            logs.sort((a, b) => new Date(b.asked_at) - new Date(a.asked_at));

            // Apply limit if provided
            if (limit && !isNaN(parseInt(limit))) {
                logs = logs.slice(0, parseInt(limit));
            }

            console.log(`📊 Found ${data.length} logs for ${providerEmail}`);
            res.json({
                providerEmail,
                totalLogs: data.length,
                logs: logs
            });
        } catch (err) {
            // File doesn't exist or is empty
            console.log(`📊 No logs found for ${providerEmail}`);
            res.json({
                providerEmail,
                totalLogs: 0,
                logs: []
            });
        }
    } catch (err) {
        console.error("Get provider logs error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ----------------------- GET STUDENT SESSION SUMMARY -----------------------
router.get("/session/summary/:email", async (req, res) => {
    try {
        const { email } = req.params;
        const { limit } = req.query;
        console.log(`📈 Getting session summary for: ${email}`);

        const safePrefix = email.replace(/[^a-zA-Z0-9@._-]/g, "_");
        const files = await fs.readdir(CHAT_DIR);
        const sessions = [];

        for (const file of files) {
            if (file.startsWith(safePrefix + "__")) {
                try {
                    const data = JSON.parse(await fs.readFile(path.join(CHAT_DIR, file), "utf8"));
                    const messageCount = data.messages ? data.messages.length : 0;
                    const lastUpdated = data.updatedAt || data.createdAt;

                    sessions.push({
                        sessionId: data.sessionId,
                        sessionName: data.sessionName,
                        createdAt: data.createdAt,
                        updatedAt: lastUpdated,
                        messageCount: messageCount
                    });
                } catch { /* skip invalid */ }
            }
        }

        // sort newest first
        sessions.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));

        // Apply limit if provided
        let finalSessions = sessions;
        if (limit && !isNaN(parseInt(limit))) {
            finalSessions = sessions.slice(0, parseInt(limit));
        }

        console.log(`📈 Found ${sessions.length} sessions for ${email}`);
        res.json({
            email,
            totalSessions: sessions.length,
            sessions: finalSessions
        });
    } catch (err) {
        console.error("Get session summary error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;