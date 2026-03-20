package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "log"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
    ID           string    `json:"id"`
    Title        string    `json:"title"`
    Ingredients  []string  `json:"ingredients"`
    Instructions string    `json:"instructions"`
    Comments     []Comment `json:"comments,omitempty"`
    AvgRating    *float64  `json:"avgRating"`
}

type Comment struct {
    Comment string `json:"comment"`
}

type RecipeUploadRequest struct {
    Title        string   `json:"title"`
    Ingredients  []string `json:"ingredients"`
    Instructions string   `json:"instructions"`
}

type CommentRequest struct {
    Comment string `json:"comment"`
}

type RatingRequest struct {
    Rating int `json:"rating"`
}

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createRecipesTable := `
    CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        ingredients TEXT NOT NULL,
        instructions TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`
    
    createCommentsTable := `
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );`
    
    createRatingsTable := `
    CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );`

    _, err = db.Exec(createRecipesTable)
    if err != nil {
        log.Fatal(err)
    }
    
    _, err = db.Exec(createCommentsTable)
    if err != nil {
        log.Fatal(err)
    }
    
    _, err = db.Exec(createRatingsTable)
    if err != nil {
        log.Fatal(err)
    }
}

func getRecipesOverview(c *fiber.Ctx) error {
    rows, err := db.Query(`
        SELECT r.id, r.title, AVG(rt.rating) as avg_rating 
        FROM recipes r
        LEFT JOIN ratings rt ON r.id = rt.recipe_id
        GROUP BY r.id, r.title
        ORDER BY r.created_at DESC
        LIMIT 20
    `)
    if err != nil {
        return c.Status(500).SendString("Server error")
    }
    defer rows.Close()

    html := `<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
</head>
<body>
    <h1>Recipe Overview</h1>
    <h2>Recent and Top-Rated Recipes</h2>
    <ul>`

    for rows.Next() {
        var id, title string
        var avgRating sql.NullFloat64
        err := rows.Scan(&id, &title, &avgRating)
        if err != nil {
            continue
        }
        
        ratingStr := "No ratings yet"
        if avgRating.Valid {
            ratingStr = fmt.Sprintf("Rating: %.1f/5", avgRating.Float64)
        }
        
        html += fmt.Sprintf(`<li><a href="/recipes/%s">%s</a> - %s</li>`, id, title, ratingStr)
    }

    html += `</ul>
</body>
</html>`

    c.Set("Content-Type", "text/html")
    return c.SendString(html)
}

func uploadRecipe(c *fiber.Ctx) error {
    var req RecipeUploadRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    id := uuid.New().String()
    ingredientsJSON, err := json.Marshal(req.Ingredients)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    _, err = db.Exec(
        "INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
        id, req.Title, string(ingredientsJSON), req.Instructions,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    recipe := Recipe{
        ID:           id,
        Title:        req.Title,
        Ingredients:  req.Ingredients,
        Instructions: req.Instructions,
        Comments:     []Comment{},
        AvgRating:    nil,
    }

    return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
    recipeID := c.Params("recipeId")

    var title, ingredientsStr, instructions string
    err := db.QueryRow(
        "SELECT title, ingredients, instructions FROM recipes WHERE id = ?",
        recipeID,
    ).Scan(&title, &ingredientsStr, &instructions)
    
    if err == sql.ErrNoRows {
        return c.Status(404).SendString("Recipe not found")
    }
    if err != nil {
        return c.Status(500).SendString("Server error")
    }

    var ingredients []string
    json.Unmarshal([]byte(ingredientsStr), &ingredients)

    var avgRating sql.NullFloat64
    db.QueryRow(
        "SELECT AVG(rating) FROM ratings WHERE recipe_id = ?",
        recipeID,
    ).Scan(&avgRating)

    rows, err := db.Query(
        "SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC",
        recipeID,
    )
    if err != nil {
        return c.Status(500).SendString("Server error")
    }
    defer rows.Close()

    var comments []string
    for rows.Next() {
        var comment string
        rows.Scan(&comment)
        comments = append(comments, comment)
    }

    html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s</title>
</head>
<body>
    <h1>%s</h1>`, title, title)

    if avgRating.Valid {
        html += fmt.Sprintf(`<p><strong>Average Rating:</strong> %.1f/5</p>`, avgRating.Float64)
    } else {
        html += `<p><strong>Average Rating:</strong> No ratings yet</p>`
    }

    html += `<h2>Ingredients</h2><ul>`
    for _, ingredient := range ingredients {
        html += fmt.Sprintf(`<li>%s</li>`, ingredient)
    }
    html += `</ul>`

    html += fmt.Sprintf(`<h2>Instructions</h2><p>%s</p>`, instructions)

    html += `<h2>Comments</h2>`
    if len(comments) > 0 {
        html += `<ul>`
        for _, comment := range comments {
            html += fmt.Sprintf(`<li>%s</li>`, comment)
        }
        html += `</ul>`
    } else {
        html += `<p>No comments yet</p>`
    }

    html += `</body></html>`

    c.Set("Content-Type", "text/html")
    return c.SendString(html)
}

func addComment(c *fiber.Ctx) error {
    recipeID := c.Params("recipeId")

    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
    if err != nil || !exists {
        return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
    }

    var req CommentRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    if req.Comment == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    _, err = db.Exec(
        "INSERT INTO comments (recipe_id, comment) VALUES (?, ?)",
        recipeID, req.Comment,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
    recipeID := c.Params("recipeId")

    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
    if err != nil || !exists {
        return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
    }

    var req RatingRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    if req.Rating < 1 || req.Rating > 5 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    _, err = db.Exec(
        "INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)",
        recipeID, req.Rating,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New()

    app.Get("/recipes", getRecipesOverview)
    app.Post("/recipes/upload", uploadRecipe)
    app.Get("/recipes/:recipeId", getRecipe)
    app.Post("/recipes/:recipeId/comments", addComment)
    app.Post("/recipes/:recipeId/ratings", addRating)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}