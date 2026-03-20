package main

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "crypto/sha256"
    "database/sql"
    "encoding/hex"
    "io"
    "log"
    "os"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var encryptionKey []byte

type AssociateCardRequest struct {
    CreditCard string `json:"credit_card"`
    Phone      string `json:"phone"`
}

type RetrieveCardsRequest struct {
    PhoneNumbers []string `json:"phone_numbers"`
}

type RetrieveCardsResponse struct {
    CardNumbers []string `json:"card_numbers"`
}

func main() {
    // Initialize encryption key from APP_SECRET
    appSecret := os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key-for-development"
    }
    hash := sha256.Sum256([]byte(appSecret))
    encryptionKey = hash[:]

    // Initialize database
    initDB()
    defer db.Close()

    // Create Fiber app
    app := fiber.New()

    // Routes
    app.Post("/associate_card", associateCard)
    app.Post("/retrieve_cards", retrieveCards)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create tables if not exists
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS cards (
        card_hash TEXT PRIMARY KEY,
        encrypted_card TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_hash TEXT NOT NULL,
        phone TEXT NOT NULL,
        UNIQUE(card_hash, phone),
        FOREIGN KEY(card_hash) REFERENCES cards(card_hash)
    );
    
    CREATE INDEX IF NOT EXISTS idx_phone ON associations(phone);
    CREATE INDEX IF NOT EXISTS idx_card_hash ON associations(card_hash);
    `
    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func hashCard(card string) string {
    hash := sha256.Sum256([]byte(card + string(encryptionKey)))
    return hex.EncodeToString(hash[:])
}

func encrypt(plaintext string) (string, error) {
    block, err := aes.NewCipher(encryptionKey)
    if err != nil {
        return "", err
    }

    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }

    nonce := make([]byte, gcm.NonceSize())
    if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
        return "", err
    }

    ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
    return hex.EncodeToString(ciphertext), nil
}

func decrypt(ciphertext string) (string, error) {
    data, err := hex.DecodeString(ciphertext)
    if err != nil {
        return "", err
    }

    block, err := aes.NewCipher(encryptionKey)
    if err != nil {
        return "", err
    }

    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }

    nonceSize := gcm.NonceSize()
    if len(data) < nonceSize {
        return "", err
    }

    nonce, ciphertext := data[:nonceSize], data[nonceSize:]
    plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
    if err != nil {
        return "", err
    }

    return string(plaintext), nil
}

func associateCard(c *fiber.Ctx) error {
    var req AssociateCardRequest
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Validate input
    if req.CreditCard == "" || req.Phone == "" {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Hash the card for indexing
    cardHash := hashCard(req.CreditCard)

    // Begin transaction
    tx, err := db.Begin()
    if err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }
    defer tx.Rollback()

    // Check if card already exists
    var count int
    err = tx.QueryRow("SELECT COUNT(*) FROM cards WHERE card_hash = ?", cardHash).Scan(&count)
    if err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }
    
    if count == 0 {
        // Card doesn't exist, encrypt and store it
        encryptedCard, err := encrypt(req.CreditCard)
        if err != nil {
            return c.SendStatus(fiber.StatusInternalServerError)
        }
        
        _, err = tx.Exec("INSERT INTO cards (card_hash, encrypted_card) VALUES (?, ?)", 
            cardHash, encryptedCard)
        if err != nil {
            return c.SendStatus(fiber.StatusInternalServerError)
        }
    }

    // Insert association (or ignore if it already exists due to UNIQUE constraint)
    _, err = tx.Exec("INSERT OR IGNORE INTO associations (card_hash, phone) VALUES (?, ?)", 
        cardHash, req.Phone)
    if err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }

    if err = tx.Commit(); err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }

    return c.SendStatus(fiber.StatusCreated)
}

func retrieveCards(c *fiber.Ctx) error {
    var req RetrieveCardsRequest
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Validate input
    if len(req.PhoneNumbers) == 0 {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Build query to find cards associated with ALL phone numbers
    query := `
        SELECT c.encrypted_card
        FROM cards c
        INNER JOIN associations a ON c.card_hash = a.card_hash
        WHERE a.phone IN (` + buildPlaceholders(len(req.PhoneNumbers)) + `)
        GROUP BY c.card_hash, c.encrypted_card
        HAVING COUNT(DISTINCT a.phone) = ?
    `
    
    args := make([]interface{}, len(req.PhoneNumbers)+1)
    for i, phone := range req.PhoneNumbers {
        args[i] = phone
    }
    args[len(req.PhoneNumbers)] = len(req.PhoneNumbers)

    rows, err := db.Query(query, args...)
    if err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }
    defer rows.Close()

    var cardNumbers []string
    for rows.Next() {
        var encryptedCard string
        if err := rows.Scan(&encryptedCard); err != nil {
            continue
        }
        
        decryptedCard, err := decrypt(encryptedCard)
        if err != nil {
            continue
        }
        cardNumbers = append(cardNumbers, decryptedCard)
    }

    if len(cardNumbers) == 0 {
        return c.SendStatus(fiber.StatusNotFound)
    }

    response := RetrieveCardsResponse{
        CardNumbers: cardNumbers,
    }

    return c.JSON(response)
}

func buildPlaceholders(n int) string {
    if n <= 0 {
        return ""
    }
    placeholders := "?"
    for i := 1; i < n; i++ {
        placeholders += ", ?"
    }
    return placeholders
}