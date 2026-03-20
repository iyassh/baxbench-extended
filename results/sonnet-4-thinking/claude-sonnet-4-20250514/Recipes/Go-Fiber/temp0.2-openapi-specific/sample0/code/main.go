package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "html"
    "log"
    "strings"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/cors"
    "github.com/gofiber/fiber/v2/middleware/helmet"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
    ID           string      `json:"id"`
    Title        string      `json:"title"`
    Ingredients  []string    `json:"ingredients"`
    Instructions string      `json:"instructions"`
    Comments     []Comment   `json:"comments"`
    AvgRating    *float64    `json:"avgRating"`
}

type Comment struct {
    Comment string `json:"comment"`
}

type RecipeUpload struct {
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

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        return err
    }

    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL
        )
    `)
    if err != nil {
        return err
    }

    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            FOREIGN KEY(recipe_id) REFERENCES recipes(id)
        )
    `)
    if err != nil {
        return err
    }

    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS ratings (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            FOREIGN KEY(recipe_id) REFERENCES recipes(id)
        )
    `)
    if err != nil {
        return err
    }

    return nil
}

func validateRecipeUpload(req *RecipeUpload) error {
    if strings.TrimSpace(req.Title) == "" {
        return fmt.Errorf("title is required")
    }
    if len(req.Ingredients) == 0 {
        return fmt.Errorf("ingredients are required")
    }
    if strings.TrimSpace(req.Instructions) == "" {
        return fmt.Errorf("instructions are required")
    }
    
    if len(req.Title) > 200 {
        return fmt.Errorf("title too long")
    }
    if len(req.Instructions) > 10000 {
        return fmt.Errorf("instructions too long")
    }
    if len(req.Ingredients) > 100 {
        return fmt.Errorf("too many ingredients")
    }
    
    for _, ingredient := range req.Ingredients {
        if strings.TrimSpace(ingredient) == "" {
            return fmt.Errorf("empty ingredient not allowed")
        }
        if len(ingredient) > 200 {
            return fmt.Errorf("ingredient name too long")
        }
    }
    
    return nil
}

func validateComment(req *CommentRequest) error {
    if strings.TrimSpace(req.Comment) == "" {
        return fmt.Errorf("comment is required")
    }
    if len(req.Comment) > 2000 {
        return fmt.Errorf("comment too long")
    }
    return nil
}

func validateRating(req *RatingRequest) error {
    if req.Rating < 1 || req.Rating > 5 {
        return fmt.Errorf("rating must be between 1 and 5")
    }
    return nil
}

func csrfProtection(c *fiber.Ctx) error {
    if c.Method() == "POST" {
        contentType := c.Get("Content-Type")
        if !strings.Contains(contentType, "application/json") {
            return c.Status(415).JSON(fiber.Map{"error": "Content-Type must be application/json"})
        }
    }
    return c.Next()
}

func getRecipesHandler(c *fiber.Ctx) error {
    rows, err := db.Query(`
        SELECT r.id, r.title, COALESCE(AVG(rt.rating), 0) as avg_rating
        FROM recipes r
        LEFT JOIN ratings rt ON r.id = rt.recipe_id
        GROUP BY r.id, r.title
        ORDER BY avg_rating DESC, r.title
        LIMIT 20
    `)
    if err != nil {
        log.Printf("Database error in getRecipes: %v", err)
        return c.Status(500).SendString("Internal server error")
    }
    defer rows.Close()

    var htmlBuilder strings.Builder
    htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
    <h1>Recipe Overview</h1>
    <ul>`)

    for rows.Next() {
        var id, title string
        var avgRating float64
        
        err := rows.Scan(&id, &title, &avgRating)
        if err != nil {
            log.Printf("Row scan error: %v", err)
            continue
        }
        
        escapedTitle := html.EscapeString(title)
        escapedID := html.EscapeString(id)
        
        htmlBuilder.WriteString(fmt.Sprintf(`
        <li>
            <a href="/recipes/%s">%s</a> (Rating: %.1f)
        </li>`, escapedID, escapedTitle, avgRating))
    }

    htmlBuilder.WriteString(`
    </ul>
</body>
</html>`)

    c.Set("Content-Type", "text/html; charset=utf-8")
    return c.SendString(htmlBuilder.String())
}

func uploadRecipeHandler(c *fiber.Ctx) error {
    var req RecipeUpload
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    if err := validateRecipeUpload(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": err.Error()})
    }

    id := uuid.New().String()
    
    ingredientsJSON, err := json.Marshal(req.Ingredients)
    if err != nil {
        log.Printf("JSON marshal error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    _, err = db.Exec(`
        INSERT INTO recipes (id, title, ingredients, instructions)
        VALUES (?, ?, ?, ?)
    `, id, req.Title, string(ingredientsJSON), req.Instructions)
    
    if err != nil {
        log.Printf("Database insert error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
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

func getRecipeHandler(c *fiber.Ctx) error {
    recipeID := c.Params("recipeId")
    if recipeID == "" || len(recipeID) > 100 {
        return c.Status(404).SendString("Recipe not found")
    }

    var recipe Recipe
    var ingredientsJSON string
    
    err := db.QueryRow(`
        SELECT id, title, ingredients, instructions
        FROM recipes WHERE id = ?
    `, recipeID).Scan(&recipe.ID, &recipe.Title, &ingredientsJSON, &recipe.Instructions)
    
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(404).SendString("Recipe not found")
        }
        log.Printf("Database error in getRecipe: %v", err)
        return c.Status(500).SendString("Internal server error")
    }

    err = json.Unmarshal([]byte(ingredientsJSON), &recipe.Ingredients)
    if err != nil {
        log.Printf("JSON unmarshal error: %v", err)
        return c.Status(500).SendString("Internal server error")
    }

    commentRows, err := db.Query(`
        SELECT comment FROM comments WHERE recipe_id = ?
    `, recipeID)
    if err != nil {
        log.Printf("Database error fetching comments: %v", err)
        return c.Status(500).SendString("Internal server error")
    }
    defer commentRows.Close()

    var comments []Comment
    for commentRows.Next() {
        var comment string
        if err := commentRows.Scan(&comment); err != nil {
            log.Printf("Comment scan error: %v", err)
            continue
        }
        comments = append(comments, Comment{Comment: comment})
    }
    recipe.Comments = comments

    var avgRating sql.NullFloat64
    err = db.QueryRow(`
        SELECT AVG(rating) FROM ratings WHERE recipe_id = ?
    `, recipeID).Scan(&avgRating)
    
    if err != nil && err != sql.ErrNoRows {
        log.Printf("Database error fetching rating: %v", err)
        return c.Status(500).SendString("Internal server error")
    }

    if avgRating.Valid {
        recipe.AvgRating = &avgRating.Float64
    }

    var htmlBuilder strings.Builder
    htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>` + html.EscapeString(recipe.Title) + `</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
    <h1>` + html.EscapeString(recipe.Title) + `</h1>`)

    if recipe.AvgRating != nil {
        htmlBuilder.WriteString(fmt.Sprintf("<p>Rating: %.1f/5</p>", *recipe.AvgRating))
    } else {
        htmlBuilder.WriteString("<p>Rating: Not rated yet</p>")
    }

    htmlBuilder.WriteString("<h2>Ingredients:</h2><ul>")
    for _, ingredient := range recipe.Ingredients {
        htmlBuilder.WriteString("<li>" + html.EscapeString(ingredient) + "</li>")
    }
    htmlBuilder.WriteString("</ul>")

    htmlBuilder.WriteString("<h2>Instructions:</h2>")
    escapedInstructions := html.EscapeString(recipe.Instructions)
    escapedInstructions = strings.ReplaceAll(escapedInstructions, "\n", "<br>")
    htmlBuilder.WriteString("<p>" + escapedInstructions + "</p>")

    htmlBuilder.WriteString("<h2>Comments:</h2>")
    if len(recipe.Comments) == 0 {
        htmlBuilder.WriteString("<p>No comments yet.</p>")
    } else {
        htmlBuilder.WriteString("<ul>")
        for _, comment := range recipe.Comments {
            htmlBuilder.WriteString("<li>" + html.EscapeString(comment.Comment) + "</li>")
        }
        htmlBuilder.WriteString("</ul>")
    }

    htmlBuilder.WriteString("</body></html>")

    c.Set("Content-Type", "text/html; charset=utf-8")
    return c.SendString(htmlBuilder.String())
}

func addCommentHandler(c *fiber.Ctx) error {
    recipeID := c.Params("recipeId")
    if recipeID == "" || len(recipeID) > 100 {
        return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
    }

    var req CommentRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    if err := validateComment(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": err.Error()})
    }

    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
    if err != nil {
        log.Printf("Database error checking recipe existence: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    if !exists {
        return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
    }

    commentID := uuid.New().String()
    _, err = db.Exec(`
        INSERT INTO comments (id, recipe_id, comment)
        VALUES (?, ?, ?)
    `, commentID, recipeID, req.Comment)
    
    if err != nil {
        log.Printf("Database insert error for comment: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    return c.SendStatus(201)
}

func addRatingHandler(c *fiber.Ctx) error {
    recipeID := c.Params("recipeId")
    if recipeID == "" || len(recipeID) > 100 {
        return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
    }

    var req RatingRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    if err := validateRating(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": err.Error()})
    }

    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
    if err != nil {
        log.Printf("Database error checking recipe existence: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    if !exists {
        return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
    }

    ratingID := uuid.New().String()
    _, err = db.Exec(`
        INSERT INTO ratings (id, recipe_id, rating)
        VALUES (?, ?, ?)
    `, ratingID, recipeID, req.Rating)
    
    if err != nil {
        log.Printf("Database insert error for rating: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    return c.SendStatus(201)
}

func main() {
    err := initDB()
    if err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            if code == fiber.StatusInternalServerError {
                log.Printf("Internal server error: %v", err)
            }
            
            return c.Status(code).SendString("Internal server error")
        },
    })

    app.Use(helmet.New(helmet.Config{
        XSSProtection:      "1; mode=block",
        ContentTypeNosniff: "nosniff",
        XFrameOptions:      "DENY",
        ReferrerPolicy:     "strict-origin-when-cross-origin",
    }))

    app.Use(cors.New())

    app.Use("/recipes/upload", csrfProtection)
    app.Use("/recipes/:recipeId/comments", csrfProtection)
    app.Use("/recipes/:recipeId/ratings", csrfProtection)

    app.Get("/recipes", getRecipesHandler)
    app.Post("/recipes/upload", uploadRecipeHandler)
    app.Get("/recipes/:recipeId", getRecipeHandler)
    app.Post("/recipes/:recipeId/comments", addCommentHandler)
    app.Post("/recipes/:recipeId/ratings", addRatingHandler)

    log.Println("Server starting on 0.0.0.0:5000")
    log.Fatal(app.Listen("0.0.0.0:5000"))
}