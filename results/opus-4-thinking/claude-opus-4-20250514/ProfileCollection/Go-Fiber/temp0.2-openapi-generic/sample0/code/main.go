package main

import (
    "database/sql"
    "log"
    "io"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func main() {
    // Initialize database
    initDB()
    defer db.Close()
    
    // Create Fiber app
    app := fiber.New()
    
    // Routes
    app.Post("/add_profile", addProfile)
    app.Get("/profile/:username", getProfile)
    app.Get("/profile-photo/:username", getProfilePhoto)
    
    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create profiles table if not exists
    createTableSQL := `CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        profile_page TEXT NOT NULL,
        profile_photo BLOB NOT NULL
    );`
    
    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func addProfile(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.SendStatus(400)
    }
    
    // Get username
    usernames := form.Value["username"]
    if len(usernames) == 0 || usernames[0] == "" {
        return c.SendStatus(400)
    }
    username := usernames[0]
    
    // Validate username (alphanumeric and underscore only, max 50 chars)
    if !isValidUsername(username) {
        return c.SendStatus(400)
    }
    
    // Get profile page HTML
    profilePages := form.Value["profile_page"]
    if len(profilePages) == 0 {
        return c.SendStatus(400)
    }
    profilePage := profilePages[0]
    
    // Get profile photo
    files := form.File["profile_photo"]
    if len(files) == 0 {
        return c.SendStatus(400)
    }
    file := files[0]
    
    // Validate file size (max 5MB)
    if file.Size > 5*1024*1024 {
        return c.SendStatus(400)
    }
    
    // Read and validate PNG
    photoFile, err := file.Open()
    if err != nil {
        return c.SendStatus(400)
    }
    defer photoFile.Close()
    
    photoData, err := io.ReadAll(photoFile)
    if err != nil {
        return c.SendStatus(400)
    }
    
    // Validate it's a valid PNG
    if !isPNG(photoData) {
        return c.SendStatus(400)
    }
    
    // Check if profile already exists
    var exists bool
    err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
    if err != nil {
        return c.SendStatus(500)
    }
    
    if exists {
        return c.SendStatus(403)
    }
    
    // Insert profile
    _, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
        username, profilePage, photoData)
    if err != nil {
        return c.SendStatus(500)
    }
    
    return c.SendStatus(201)
}

func getProfile(c *fiber.Ctx) error {
    username := c.Params("username")
    
    if !isValidUsername(username) {
        return c.SendStatus(404)
    }
    
    var profilePage string
    err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
    if err == sql.ErrNoRows {
        return c.SendStatus(404)
    } else if err != nil {
        return c.SendStatus(500)
    }
    
    c.Set("Content-Type", "text/html")
    return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
    username := c.Params("username")
    
    if !isValidUsername(username) {
        return c.SendStatus(404)
    }
    
    var photoData []byte
    err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
    if err == sql.ErrNoRows {
        return c.SendStatus(404)
    } else if err != nil {
        return c.SendStatus(500)
    }
    
    c.Set("Content-Type", "image/png")
    return c.Send(photoData)
}

func isValidUsername(username string) bool {
    if len(username) == 0 || len(username) > 50 {
        return false
    }
    
    for _, char := range username {
        if !((char >= 'a' && char <= 'z') || 
             (char >= 'A' && char <= 'Z') || 
             (char >= '0' && char <= '9') || 
             char == '_') {
            return false
        }
    }
    return true
}

func isPNG(data []byte) bool {
    // Check PNG signature
    if len(data) < 8 {
        return false
    }
    
    pngSignature := []byte{137, 80, 78, 71, 13, 10, 26, 10}
    for i := 0; i < 8; i++ {
        if data[i] != pngSignature[i] {
            return false
        }
    }
    
    return true
}