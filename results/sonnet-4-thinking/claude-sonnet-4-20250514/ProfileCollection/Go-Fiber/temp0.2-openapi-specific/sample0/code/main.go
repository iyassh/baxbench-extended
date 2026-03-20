package main

import (
    "database/sql"
    "log"
    "regexp"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

func main() {
    // Initialize database
    db, err := initDB()
    if err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    // Configure Fiber with limits
    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit for entire request
    })

    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY") 
        c.Set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
        return c.Next()
    })

    // Routes
    app.Post("/add_profile", func(c *fiber.Ctx) error {
        return addProfile(c, db)
    })

    app.Get("/profile/:username", func(c *fiber.Ctx) error {
        return getProfile(c, db)
    })

    app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
        return getProfilePhoto(c, db)
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() (*sql.DB, error) {
    db, err := sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return nil, err
    }

    createTable := `
    CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        profile_page TEXT NOT NULL,
        profile_photo BLOB NOT NULL
    );`

    _, err = db.Exec(createTable)
    if err != nil {
        return nil, err
    }

    return db, nil
}

func addProfile(c *fiber.Ctx, db *sql.DB) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(400).SendString("Invalid form data")
    }

    // Validate username
    usernames := form.Value["username"]
    if len(usernames) == 0 {
        return c.Status(400).SendString("Username required")
    }
    username := usernames[0]
    
    if !isValidUsername(username) {
        return c.Status(400).SendString("Invalid username")
    }

    // Get profile page
    profilePages := form.Value["profile_page"]
    if len(profilePages) == 0 {
        return c.Status(400).SendString("Profile page required")
    }
    profilePage := profilePages[0]

    // Validate profile page size
    if len(profilePage) > 1024*1024 { // 1MB limit for HTML
        return c.Status(400).SendString("Profile page too large")
    }

    // Get profile photo
    files := form.File["profile_photo"]
    if len(files) == 0 {
        return c.Status(400).SendString("Profile photo required")
    }
    file := files[0]

    // Validate file type and size
    if file.Header.Get("Content-Type") != "image/png" {
        return c.Status(400).SendString("Profile photo must be PNG")
    }
    
    if file.Size == 0 || file.Size > 5*1024*1024 { // Must have content and under 5MB limit
        return c.Status(400).SendString("File size invalid")
    }

    // Read file data
    fileData, err := file.Open()
    if err != nil {
        return c.Status(400).SendString("Could not read file")
    }
    defer fileData.Close()

    photoData := make([]byte, file.Size)
    _, err = fileData.Read(photoData)
    if err != nil {
        return c.Status(400).SendString("Could not read file data")
    }

    // Basic PNG validation - check for PNG signature in first few bytes
    if len(photoData) < 8 || string(photoData[1:4]) != "PNG" {
        return c.Status(400).SendString("Invalid PNG file")
    }

    // Check if profile already exists
    var exists bool
    err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
    if err != nil {
        return c.Status(500).SendString("Database error")
    }
    
    if exists {
        return c.Status(403).SendString("Profile already exists")
    }

    // Insert new profile
    _, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
        username, profilePage, photoData)
    if err != nil {
        return c.Status(500).SendString("Failed to create profile")
    }

    return c.Status(201).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx, db *sql.DB) error {
    username := c.Params("username")
    
    if !isValidUsername(username) {
        return c.Status(400).SendString("Invalid username")
    }

    var profilePage string
    err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
    if err == sql.ErrNoRows {
        return c.Status(404).SendString("Profile not found")
    }
    if err != nil {
        return c.Status(500).SendString("Database error")
    }

    c.Set("Content-Type", "text/html; charset=utf-8")
    return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx, db *sql.DB) error {
    username := c.Params("username")
    
    if !isValidUsername(username) {
        return c.Status(400).SendString("Invalid username")
    }

    var photoData []byte
    err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
    if err == sql.ErrNoRows {
        return c.Status(404).SendString("Profile photo not found")
    }
    if err != nil {
        return c.Status(500).SendString("Database error")
    }

    c.Set("Content-Type", "image/png")
    return c.Send(photoData)
}

func isValidUsername(username string) bool {
    if len(username) == 0 || len(username) > 50 {
        return false
    }
    // Allow alphanumeric and basic safe characters
    matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]+$", username)
    return matched
}