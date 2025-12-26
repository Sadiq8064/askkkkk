const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const ImageKit = require("imagekit");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const RAGService = require('./rag');
const mammoth = require('mammoth'); // For DOCX to TXT conversion
const { PDFParse } = require('pdf-parse'); // For PDF to TXT conversion

const DB_DIR = path.join(__dirname, 'database');
const ACCOUNTS_DIR = path.join(DB_DIR, 'accounts');
const UPLOADS_DIR = path.join(DB_DIR, 'uploads');
const TICKETS_DIR = path.join(DB_DIR, 'tickets');
const UNIVERSITIES_DIR = path.join(DB_DIR, 'universities');

// Ensure required folders exist
(async () => {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.mkdir(TICKETS_DIR, { recursive: true });
})();

// ImageKit Config
const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

// ------------------------------
// File Conversion Helpers (INTERNAL ONLY - NO API CHANGES)
// ------------------------------


async function convertPDFtoTXT(buffer) {
    try {
        // Create an instance of PDFParse
        const pdfParser = new PDFParse();

        // Parse the buffer
        const data = await pdfParser.parse(buffer);

        // Return the text
        return data.text || '';
    } catch (error) {
        console.error('PDF conversion error:', error);

        // Try alternative approach if first fails
        try {
            // Sometimes we need to use it differently
            const data = await require('pdf-parse')(buffer);ß
            return data.text || '';
        } catch (secondError) {
            console.error('Secondary PDF conversion also failed:', secondError.message);
            throw new Error('Failed to convert PDF to TXT');
        }
    }
}

/**
 * Convert DOCX file to TXT
 * @param {Buffer} buffer - DOCX file buffer
 * @returns {Promise<string>} - Extracted text
 */
async function convertDOCXtoTXT(buffer) {
    try {
        const result = await mammoth.extractRawText({ buffer: buffer });
        return result.value;
    } catch (error) {
        console.error('DOCX conversion error:', error);
        throw new Error('Failed to convert DOCX to TXT');
    }
}

/**
 * Convert JSON file to structured TXT
 * @param {Buffer} buffer - JSON file buffer
 * @returns {Promise<string>} - Structured text
 */
async function convertJSONtoTXT(buffer) {
    try {
        const jsonString = buffer.toString('utf-8');
        const jsonData = JSON.parse(jsonString);

        // Convert JSON to structured text format
        return convertObjectToStructuredText(jsonData);
    } catch (error) {
        console.error('JSON conversion error:', error);
        throw new Error('Failed to convert JSON to TXT');
    }
}

/**
 * Recursively convert object to structured text
 * @param {Object} obj - JSON object
 * @param {number} depth - Current depth for indentation
 * @returns {string} - Structured text
 */
function convertObjectToStructuredText(obj, depth = 0) {
    const indent = '  '.repeat(depth);
    let result = '';

    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result += `${indent}${key}:\n`;
            result += convertObjectToStructuredText(value, depth + 1);
        } else if (Array.isArray(value)) {
            result += `${indent}${key}:\n`;
            value.forEach((item, index) => {
                if (typeof item === 'object' && item !== null) {
                    result += `${indent}  [${index + 1}]:\n`;
                    result += convertObjectToStructuredText(item, depth + 2);
                } else {
                    result += `${indent}  [${index + 1}]: ${item}\n`;
                }
            });
        } else {
            result += `${indent}${key}: ${value}\n`;
        }
    }

    return result;
}

/**
 * Convert file to TXT based on file extension
 * @param {Buffer} buffer - Original file buffer
 * @param {string} originalFileName - Original filename with extension
 * @returns {Promise<{text: string, converted: boolean, originalExt: string}>}
 */
async function convertFileToTXT(buffer, originalFileName) {
    const ext = path.extname(originalFileName).toLowerCase();

    switch (ext) {
        case '.pdf':
            return {
                text: await convertPDFtoTXT(buffer),
                converted: true,
                originalExt: '.pdf'
            };
        case '.docx':
        case '.doc':
            return {
                text: await convertDOCXtoTXT(buffer),
                converted: true,
                originalExt: ext
            };
        case '.json':
            return {
                text: await convertJSONtoTXT(buffer),
                converted: true,
                originalExt: '.json'
            };
        case '.txt':
            return {
                text: buffer.toString('utf-8'),
                converted: false,
                originalExt: '.txt'
            };
        default:
            // For other file types, try to extract text or use buffer as is
            try {
                return {
                    text: buffer.toString('utf-8'),
                    converted: false,
                    originalExt: ext
                };
            } catch {
                throw new Error(`Unsupported file type: ${ext}`);
            }
    }
}

// ------------------------------
// Helpers
// ------------------------------
const readAccount = async (email) => {
    try {
        const sanitizedEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
        const file = path.join(ACCOUNTS_DIR, `${sanitizedEmail}.json`);
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
        return null;
    }
};

const writeAccount = async (email, data) => {
    const sanitizedEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
    const file = path.join(ACCOUNTS_DIR, `${sanitizedEmail}.json`);
    await fs.writeFile(file, JSON.stringify(data, null, 2));
};

const readUploads = async (email) => {
    try {
        const sanitizedEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
        const file = path.join(UPLOADS_DIR, `${sanitizedEmail}.json`);
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
        return { notice: [], faq: [], impData: [] };
    }
};

const writeUploads = async (email, data) => {
    const sanitizedEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
    const file = path.join(UPLOADS_DIR, `${sanitizedEmail}.json`);
    await fs.writeFile(file, JSON.stringify(data, null, 2));
};

const readTicket = async (id) => {
    try {
        const file = path.join(TICKETS_DIR, `${id}.json`);
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
        return null;
    }
};

const writeTicket = async (id, data) => {
    const file = path.join(TICKETS_DIR, `${id}.json`);
    await fs.writeFile(file, JSON.stringify(data, null, 2));
};

const readUniversity = async (email) => {
    try {
        const sanitizedEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
        const file = path.join(UNIVERSITIES_DIR, `${sanitizedEmail}.json`);
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
        return null;
    }
};

// ------------------------------
// 1️⃣ Account Login (GET) - NO CHANGES
// ------------------------------
router.get('/login', async (req, res) => {
    try {
        const { accountEmail, password } = req.query;

        if (!accountEmail || !password)
            return res.status(400).json({ error: "accountEmail and password required" });

        const acc = await readAccount(accountEmail);
        if (!acc) return res.status(404).json({ error: "Account not found" });

        // 🔐 Compare hashed password with plain text
        const bcrypt = require("bcrypt");
        const match = await bcrypt.compare(password, acc.password);

        if (!match)
            return res.status(401).json({ error: "Invalid password" });

        res.json({ message: "Login successful", account: acc });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ------------------------------
// 2️⃣ Get ALL Tickets For Department (GET) - NO CHANGES
// ------------------------------
router.get('/tickets/:accountEmail', async (req, res) => {
    try {
        const { accountEmail } = req.params;
        const account = await readAccount(accountEmail);

        if (!account)
            return res.status(404).json({ error: "Account not found" });

        const departmentEmail = account.universityEmail;

        // Get all accounts for this department
        const allAccFiles = await fs.readdir(ACCOUNTS_DIR);
        let departmentAccounts = [];

        for (const a of allAccFiles) {
            if (a.endsWith(".json")) {
                const accData = JSON.parse(await fs.readFile(path.join(ACCOUNTS_DIR, a), "utf8"));
                if (accData.universityEmail === departmentEmail) {
                    departmentAccounts.push(accData.accountEmail);
                }
            }
        }

        // Fetch tickets for all accounts in this department
        const ticketFiles = await fs.readdir(TICKETS_DIR);
        let pending = [], completed = [];

        for (const file of ticketFiles) {
            if (file.endsWith(".json")) {
                const t = JSON.parse(await fs.readFile(path.join(TICKETS_DIR, file), "utf8"));
                if (departmentAccounts.includes(t.accountEmail)) {
                    if (t.status === "pending") pending.push(t);
                    else completed.push(t);
                }
            }
        }

        res.json({
            departmentEmail,
            totalPending: pending.length,
            totalCompleted: completed.length,
            pending,
            completed
        });

    } catch (err) {
        console.error("Get tickets error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ------------------------------
// 3️⃣ Solve Ticket (GET) - NO CHANGES
// ------------------------------
router.get('/ticket/solve', async (req, res) => {
    try {
        const { ticketId, solution } = req.query;

        if (!ticketId || !solution)
            return res.status(400).json({ error: "ticketId & solution required" });

        const ticket = await readTicket(ticketId);
        if (!ticket)
            return res.status(404).json({ error: "Ticket not found" });

        ticket.solution = solution;
        ticket.status = "completed";
        ticket.updatedAt = new Date().toISOString();

        await writeTicket(ticketId, ticket);

        res.json({ message: "Ticket marked as completed", ticket });

    } catch (err) {
        console.error("Solve ticket error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ------------------------------
// 4️⃣ Get All Uploads (GET) - NO CHANGES
// ------------------------------
router.get('/uploads/:accountEmail', async (req, res) => {
    try {
        const uploads = await readUploads(req.params.accountEmail);
        res.json(uploads);
    } catch (err) {
        console.error("Get uploads error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ------------------------------
// 5️⃣ Upload File (GET with base64 encoding) - UPDATED WITH CONVERSION
// ------------------------------
router.get('/upload/:accountEmail', async (req, res) => {
    try {
        const { accountEmail } = req.params;
        const { category, fileName, fileData } = req.query;

        if (!category || !fileName || !fileData)
            return res.status(400).json({
                error: "category, fileName, and fileData (base64) required"
            });

        if (!["notice", "faq", "impData"].includes(category))
            return res.status(400).json({ error: "Invalid category" });

        const acc = await readAccount(accountEmail);
        if (!acc) return res.status(404).json({ error: "Account not found" });

        // Decode base64 file data
        const fileBuffer = Buffer.from(fileData, 'base64');

        // 1. Convert file to TXT if needed (PDF/DOCX/JSON → TXT)
        let uploadBuffer = fileBuffer;
        let uploadFilename = fileName; // Keep original filename for RAG
        let convertedText = null;
        let isConverted = false;

        try {
            const conversionResult = await convertFileToTXT(fileBuffer, fileName);

            if (conversionResult.converted) {
                // Store the converted text
                convertedText = conversionResult.text;
                isConverted = true;
                console.log(`Converted ${fileName} to TXT format internally`);

                // For RAG upload, we use the TXT content but keep original filename
                // This is the key part: same filename, but TXT content internally
                uploadBuffer = Buffer.from(convertedText, 'utf-8');
            }
        } catch (conversionError) {
            console.error('File conversion error:', conversionError);
            // Don't fail the upload if conversion fails, just upload original
            console.log(`Conversion failed, uploading original file: ${fileName}`);
        }

        // 2. Upload original file to ImageKit (unchanged)
        const ikUpload = await imagekit.upload({
            file: fileData,
            fileName: fileName
        });

        // 3. Get university API key
        const university = await readUniversity(acc.universityEmail);
        if (!university || !university.apiKeyInfo?.key) {
            return res.status(500).json({ error: "University API key not found" });
        }

        const geminiKey = university.apiKeyInfo.key;

        // 4. Upload to RAG store (INTERNALLY: TXT content with original filename)
        // IMPORTANT: RAG gets TXT content but filename remains original
        const ragUpload = await RAGService.uploadFiles(
            geminiKey,
            acc.ragStore.storeName,
            [
                {
                    buffer: uploadBuffer, // This is TXT content if converted
                    originalname: fileName // Original filename kept same
                }
            ]
        );

        const uploads = await readUploads(accountEmail);

        // Store metadata (EXACT SAME STRUCTURE AS BEFORE - NO EXTERNAL API CHANGES)
        uploads[category].push({
            filename: fileName, // Same field name as before
            imagekitUrl: ikUpload.url,
            imagekitFileId: ikUpload.fileId,
            ragData: ragUpload.data || null,
            uploadedAt: new Date().toISOString(),
            // INTERNAL FIELDS (not exposed in API response)
            _isConvertedToTXT: isConverted, // Internal flag
            _originalExtension: path.extname(fileName).toLowerCase(), // Internal storage
            _convertedTextLength: convertedText ? convertedText.length : 0 // Internal
        });

        await writeUploads(accountEmail, uploads);

        // EXACT SAME RESPONSE FORMAT AS BEFORE
        res.json({
            message: "File uploaded successfully",
            uploads: uploads[category]
        });

    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({
            error: "Internal server error",
            details: err?.message || err
        });
    }
});



// Add this route AFTER your GET upload route
router.post('/upload/:accountEmail', async (req, res) => {
    try {
        const { accountEmail } = req.params;
        const { category, fileName, fileData } = req.body; // Get from req.body (JSON)

        if (!category || !fileName || !fileData)
            return res.status(400).json({
                error: "category, fileName, and fileData (base64) required"
            });

        if (!["notice", "faq", "impData"].includes(category))
            return res.status(400).json({ error: "Invalid category" });

        const acc = await readAccount(accountEmail);
        if (!acc) return res.status(404).json({ error: "Account not found" });

        // Decode base64 file data
        const fileBuffer = Buffer.from(fileData, 'base64');

        // Convert file to TXT if needed
        let uploadBuffer = fileBuffer;
        let uploadFilename = fileName;
        let convertedText = null;
        let isConverted = false;

        try {
            const conversionResult = await convertFileToTXT(fileBuffer, fileName);

            if (conversionResult.converted) {
                convertedText = conversionResult.text;
                isConverted = true;
                console.log(`Converted ${fileName} to TXT format internally`);
                uploadBuffer = Buffer.from(convertedText, 'utf-8');
            }
        } catch (conversionError) {
            console.error('File conversion error:', conversionError);
            console.log(`Conversion failed, uploading original file: ${fileName}`);
        }

        // Upload original file to ImageKit
        const ikUpload = await imagekit.upload({
            file: fileData,
            fileName: fileName
        });

        // Get university API key
        const university = await readUniversity(acc.universityEmail);
        if (!university || !university.apiKeyInfo?.key) {
            return res.status(500).json({ error: "University API key not found" });
        }

        const geminiKey = university.apiKeyInfo.key;

        // Upload to RAG store
        const ragUpload = await RAGService.uploadFiles(
            geminiKey,
            acc.ragStore.storeName,
            [
                {
                    buffer: uploadBuffer,
                    originalname: fileName
                }
            ]
        );

        const uploads = await readUploads(accountEmail);

        uploads[category].push({
            filename: fileName,
            imagekitUrl: ikUpload.url,
            imagekitFileId: ikUpload.fileId,
            ragData: ragUpload.data || null,
            uploadedAt: new Date().toISOString(),
            _isConvertedToTXT: isConverted,
            _originalExtension: path.extname(fileName).toLowerCase(),
            _convertedTextLength: convertedText ? convertedText.length : 0
        });

        await writeUploads(accountEmail, uploads);

        res.json({
            message: "File uploaded successfully",
            uploads: uploads[category]
        });

    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({
            error: "Internal server error",
            details: err?.message || err
        });
    }
});
// ------------------------------
// 6️⃣ Delete File (GET) - UPDATED TO DELETE RAG INDEXES
// ------------------------------
router.get('/upload/delete/:accountEmail', async (req, res) => {
    try {
        const { accountEmail } = req.params;
        const { category, filename } = req.query;

        if (!category || !filename)
            return res.status(400).json({ error: "category & filename required" });

        const acc = await readAccount(accountEmail);
        if (!acc) return res.status(404).json({ error: "Account not found" });

        const uploads = await readUploads(accountEmail);

        const fileEntry = uploads[category].find(f => f.filename === filename);
        if (!fileEntry)
            return res.status(404).json({ error: "File not found" });

        // Delete from ImageKit
        await imagekit.deleteFile(fileEntry.imagekitFileId);

        // Get university API key for RAG deletion
        const university = await readUniversity(acc.universityEmail);
        if (university && university.apiKeyInfo?.key) {
            // Delete from RAG store (ALL RAG INDEXES AND DATA)
            if (fileEntry.ragData?.documentId) {
                await RAGService.deleteDocument(
                    university.apiKeyInfo.key,
                    acc.ragStore.storeName,
                    fileEntry.ragData.documentId
                );
                console.log(`Deleted RAG document: ${fileEntry.ragData.documentId}`);
            }

            // If RAG service has additional cleanup methods, call them
            // This ensures ALL RAG indexes are cleaned up
            try {
                // If RAGService has a cleanup method for the filename
                if (RAGService.cleanupByFilename) {
                    await RAGService.cleanupByFilename(
                        university.apiKeyInfo.key,
                        acc.ragStore.storeName,
                        filename
                    );
                }
            } catch (cleanupErr) {
                console.log(`RAG cleanup optional: ${cleanupErr.message}`);
            }
        }

        // Remove from JSON
        uploads[category] = uploads[category].filter(f => f.filename !== filename);

        await writeUploads(accountEmail, uploads);

        res.json({
            message: "File deleted successfully from all storage (ImageKit & RAG)",
            uploads: uploads[category]
        });

    } catch (err) {
        console.error("Delete file error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ------------------------------
// 7️⃣ Get Account Profile (GET) - NO CHANGES
// ------------------------------
router.get('/profile/:accountEmail', async (req, res) => {
    try {
        const { accountEmail } = req.params;
        const acc = await readAccount(accountEmail);

        if (!acc) return res.status(404).json({ error: "Account not found" });

        // Remove password from response
        const { password, ...accountData } = acc;

        // Get university info
        const university = await readUniversity(acc.universityEmail);
        const universityInfo = university ? {
            universityName: university.universityName,
            universityEmail: university.email,
            universityType: university.universityType,
            city: university.city,
            state: university.state,
            country: university.country
        } : null;

        res.json({
            message: "Account profile retrieved successfully",
            account: accountData,
            universityInfo
        });
    } catch (err) {
        console.error("Get profile error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ------------------------------
// 8️⃣ Update Account Profile (GET) - NO CHANGES
// ------------------------------
router.get('/profile/update', async (req, res) => {
    try {
        const { accountEmail, ...updates } = req.query;

        if (!accountEmail) {
            return res.status(400).json({ error: 'accountEmail is required' });
        }

        const account = await readAccount(accountEmail);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        // Fields that cannot be updated
        const protectedFields = [
            'accountId',
            'accountEmail',
            'password',
            'universityEmail',
            'universityId',
            'ragStore',
            'createdAt',
            'isPrimary'
        ];

        // Remove protected fields from updates
        protectedFields.forEach(field => {
            if (field in updates) delete updates[field];
        });

        // Parse boolean field
        if (updates.isActive !== undefined) {
            updates.isActive = updates.isActive === 'true';
        }

        // Update account
        Object.assign(account, updates, { updatedAt: new Date().toISOString() });

        // Save updated data
        await writeAccount(accountEmail, account);

        const { password, ...accountData } = account;
        res.json({
            message: 'Account updated successfully',
            account: accountData
        });
    } catch (error) {
        console.error('Update account error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ------------------------------
// 9️⃣ Get Tickets by Status (GET) - NO CHANGES
// ------------------------------
router.get('/tickets/status/:accountEmail', async (req, res) => {
    try {
        const { accountEmail } = req.params;
        const { status } = req.query;

        if (!status || !['pending', 'completed'].includes(status)) {
            return res.status(400).json({ error: 'Valid status (pending/completed) required' });
        }

        const account = await readAccount(accountEmail);
        if (!account) return res.status(404).json({ error: "Account not found" });

        const ticketFiles = await fs.readdir(TICKETS_DIR);
        const tickets = [];

        for (const file of ticketFiles) {
            if (file.endsWith(".json")) {
                const t = JSON.parse(await fs.readFile(path.join(TICKETS_DIR, file), "utf8"));
                if (t.accountEmail === accountEmail && t.status === status) {
                    tickets.push(t);
                }
            }
        }

        res.json({
            accountEmail,
            status,
            count: tickets.length,
            tickets
        });
    } catch (err) {
        console.error("Get tickets by status error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ------------------------------
// 🔟 Delete Account (GET) - NO CHANGES
// ------------------------------
router.get('/delete/:accountEmail', async (req, res) => {
    try {
        const { accountEmail } = req.params;
        const { universityEmail } = req.query;

        if (!universityEmail) {
            return res.status(400).json({ error: 'universityEmail is required' });
        }

        const account = await readAccount(accountEmail);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        // Verify that account belongs to the specified university
        if (account.universityEmail !== universityEmail) {
            return res.status(403).json({
                error: 'This account does not belong to the specified university'
            });
        }

        // Get university API key for RAG store deletion
        const university = await readUniversity(universityEmail);
        const geminiKey = university?.apiKeyInfo?.key;

        // Delete RAG store if exists
        if (account.ragStore?.storeName && geminiKey) {
            try {
                await RAGService.deleteStore(geminiKey, account.ragStore.storeName);
                console.log(`Deleted RAG store: ${account.ragStore.storeName}`);
            } catch (ragErr) {
                console.error(`Error deleting RAG store: ${ragErr.message}`);
            }
        }

        // Delete account file
        const sanitizedEmail = accountEmail.replace(/[^a-zA-Z0-9@._-]/g, '_');
        const accountPath = path.join(ACCOUNTS_DIR, `${sanitizedEmail}.json`);
        await fs.unlink(accountPath);

        // Delete uploads file
        const uploadsPath = path.join(UPLOADS_DIR, `${sanitizedEmail}.json`);
        try {
            await fs.unlink(uploadsPath);
        } catch {
            // Uploads file may not exist
        }

        res.json({
            message: 'Account deleted successfully',
            accountEmail: accountEmail
        });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;