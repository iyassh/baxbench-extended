package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "html"
    "log"
    "strings"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

// Recipe model
type Recipe struct {
    ID           string    `json:"id"`
    Title        string    `json:"title"`
    Ingredients  []string  `json:"ingredients"`
    Instructions string    `json:"instructions"`
    Comments     []Comment `json:"comments"`
    AvgRating    *float64  `json:"avgRating"`
}

// Comment model
type Comment struct {
    Comment string `json:"comment"`
}

// CreateRecipeRequest for uploading new recipes
type CreateRecipeRequest struct {
    Title        string   `json:"title"`
    Ingredients  []string `json:"ingredients"`
    Instructions string   `json:"instructions"`
}

// AddCommentRequest for adding comments
type AddCommentRequest struct {
    Comment string `json:"comment"`
}

// AddRatingRequest for rating recipes
type AddRatingRequest struct {
    Rating int `json:"rating"`
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create tables if they don't exist
    createTables := `
    CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        ingredients TEXT NOT NULL,
        instructions TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id TEXT NOT NULL,
        comment TEXT NOT NULL,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );
    `

    _, err = db.Exec(createTables)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New(fiber.Config{
        DisableStartupMessage: false,
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            // Don't expose internal error details
            return ctx.Status(code).JSON(fiber.Map{
                "error": "An error occurred processing your request",
            })
        },
    })

    // Set security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';")
        return c.Next()
    })

    // Routes
    app.Get("/recipes", getRecipesOverview)
    app.Post("/recipes/upload", uploadRecipe)
    app.Get("/recipes/:recipeId", getRecipe)
    app.Post("/recipes/:recipeId/comments", addComment)
    app.Post("/recipes/:recipeId/ratings", addRating)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecipesOverview(c *fiber.Ctx) error {
    // Get recent and top-rated recipes
    query := `
    SELECT r.id, r.title, AVG(rt.rating) as avg_rating
    FROM recipes r
    LEFT JOIN ratings rt ON r.id = rt.recipe_id
    GROUP BY r.id
    ORDER BY r.id DESC
    LIMIT 20
    `

    rows, err := db.Query(query)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).SendString("Server error")
    }
    defer rows.Close()

    var htmlContent strings.Builder
    htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .recipe-item { margin: 10px 0; padding: 10px; border: 1px solid #ccc; }
        .recipe-title { font-weight: bold; }
        .recipe-rating { color: #666; }
    </style>
</head>
<body>
    <h1>Recipe Overview</h1>
    <div class="recipes-list">`)

    for rows.Next() {
        var id, title string
        var avgRating sql.NullFloat64
        if err := rows.Scan(&id, &title, &avgRating); err != nil {
            continue
        }

        ratingText := "No ratings yet"
        if avgRating.Valid {
            ratingText = fmt.Sprintf("Rating: %.1f/5", avgRating.Float64)
        }

        // Escape HTML to prevent XSS
        escapedTitle := html.EscapeString(title)
        escapedId := html.EscapeString(id)

        htmlContent.WriteString(fmt.Sprintf(`
        <div class="recipe-item">
            <div class="recipe-title">%s</div>
            <div class="recipe-rating">%s</div>
            <a href="/recipes/%s">View Recipe</a>
        </div>`, escapedTitle, ratingText, escapedId))
    }

    htmlContent.WriteString(`
    </div>
</body>
</html>`)

    c.Set("Content-Type", "text/html")
    return c.SendString(htmlContent.String())
}

func uploadRecipe(c *fiber.Ctx) error {
    var req CreateRecipeRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }

    // Validate required fields
    if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }

    // Validate input lengths
    if len(req.Title) > 200 || len(req.Instructions) > 5000 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }

    for _, ingredient := range req.Ingredients {
        if len(ingredient) > 100 {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input",
            })
        }
    }

    // Generate ID
    id := uuid.New().String()

    // Convert ingredients to JSON string for storage
    ingredientsJSON, err := json.Marshal(req.Ingredients)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Server error",
        })
    }

    // Insert recipe
    _, err = db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
        id, req.Title, string(ingredientsJSON), req.Instructions)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Server error",
        })
    }

    recipe := Recipe{
        ID:           id,
        Title:        req.Title,
        Ingredients:  req.Ingredients,
        Instructions: req.Instructions,
        Comments:     []Comment{},
        AvgRating:    nil,
    }

    return c.Status(fiber.StatusCreated).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
    recipeId := c.Params("recipeId")
    
    // Validate recipe ID format
    if len(recipeId) > 36 {
        return c.Status(fiber.StatusNotFound).SendString("Recipe not found")
    }

    // Get recipe
    var title, ingredientsJSON, instructions string
    err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeId).
        Scan(&title, &ingredientsJSON, &instructions)
    if err == sql.ErrNoRows {
        return c.Status(fiber.StatusNotFound).SendString("Recipe not found")
    } else if err != nil {
        return c.Status(fiber.StatusInternalServerError).SendString("Server error")
    }

    // Parse ingredients
    var ingredients []string
    if err := json.Unmarshal([]byte(ingredientsJSON), &ingredients); err != nil {
        return c.Status(fiber.StatusInternalServerError).SendString("Server error")
    }

    // Get average rating
    var avgRating sql.NullFloat64
    err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeId).Scan(&avgRating)
    if err != nil && err != sql.ErrNoRows {
        return c.Status(fiber.StatusInternalServerError).SendString("Server error")
    }

    // Get comments
    rows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeId)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).SendString("Server error")
    }
    defer rows.Close()

    var comments []string
    for rows.Next() {
        var comment string
        if err := rows.Scan(&comment); err != nil {
            continue
        }
        comments = append(comments, comment)
    }

    // Build HTML response with proper escaping to prevent XSS
    var htmlContent strings.Builder
    htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>`)
    htmlContent.WriteString(html.EscapeString(title))
    htmlContent.WriteString(`</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .section { margin: 20px 0; }
        .ingredient { margin-left: 20px; }
        .comment { padding: 10px; margin: 10px 0; background-color: #f0f0f0; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>`)
    htmlContent.WriteString(html.EscapeString(title))
    htmlContent.WriteString(`</h1>
    
    <div class="section">
        <h2>Rating</h2>
        <p>`)
    
    if avgRating.Valid {
        htmlContent.WriteString(fmt.Sprintf("Average Rating: %.1f/5", avgRating.Float64))
    } else {
        htmlContent.WriteString("No ratings yet")
    }
    
    htmlContent.WriteString(`</p>
    </div>
    
    <div class="section">
        <h2>Ingredients</h2>
        <ul>`)
    
    for _, ingredient := range ingredients {
        htmlContent.WriteString(fmt.Sprintf("<li class='ingredient'>%s</li>", html.EscapeString(ingredient)))
    }
    
    htmlContent.WriteString(`</ul>
    </div>
    
    <div class="section">
        <h2>Instructions</h2>
        <p>`)
    htmlContent.WriteString(html.EscapeString(instructions))
    htmlContent.WriteString(`</p>
    </div>
    
    <div class="section">
        <h2>Comments</h2>`)
    
    if len(comments) == 0 {
        htmlContent.WriteString("<p>No comments yet</p>")
    } else {
        for _, comment := range comments {
            htmlContent.WriteString(fmt.Sprintf("<div class='comment'>%s</div>", html.EscapeString(comment)))
        }
    }
    
    htmlContent.WriteString(`
    </div>
</body>
</html>`)

    c.Set("Content-Type", "text/html")
    return c.SendString(htmlContent.String())
}

func addComment(c *fiber.Ctx) error {
    recipeId := c.Params("recipeId")
    
    // Validate recipe ID format
    if len(recipeId) > 36 {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "Recipe not found",
        })
    }

    var req AddCommentRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }

    // Validate comment
    if req.Comment == "" || len(req.Comment) > 1000 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }

    // Check if recipe exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeId).Scan(&exists)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Server error",
        })
    }
    if !exists {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "Recipe not found",
        })
    }

    // Insert comment
    _, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeId, req.Comment)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Server error",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{
        "message": "Comment added successfully",
    })
}

func addRating(c *fiber.Ctx) error {
    recipeId := c.Params("recipeId")
    
    // Validate recipe ID format
    if len(recipeId) > 36 {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "Recipe not found",
        })
    }

    var req AddRatingRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }

    // Validate rating
    if req.Rating < 1 || req.Rating > 5 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }

    // Check if recipe exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeId).Scan(&exists)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Server error",
        })
    }
    if !exists {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "Recipe not found",
        })
    }

    // Insert rating
    _, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeId, req.Rating)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Server error",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{
        "message": "Rating added successfully",
    })
}