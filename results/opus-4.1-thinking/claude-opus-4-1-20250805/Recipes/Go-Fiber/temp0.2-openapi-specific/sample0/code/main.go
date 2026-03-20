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

type Recipe struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Ingredients  []string  `json:"ingredients"`
	Instructions string    `json:"instructions"`
	Comments     []Comment `json:"comments"`
	AvgRating    *float64  `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type UploadRecipeRequest struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type AddCommentRequest struct {
	Comment string `json:"comment"`
}

type AddRatingRequest struct {
	Rating int `json:"rating"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
		ErrorHandler: func(ctx *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			message := "Internal Server Error"
			if code < 500 {
				message = err.Error()
			}
			return ctx.Status(code).JSON(fiber.Map{"error": message})
		},
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		return c.Next()
	})

	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecipesOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id
		ORDER BY r.created_at DESC
		LIMIT 10
	`)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}
	defer rows.Close()

	var htmlContent strings.Builder
	htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Recipe Overview</title>
	<meta charset="utf-8">
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		h1 { color: #333; }
		.recipe-item { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
		.recipe-title { font-weight: bold; }
		.recipe-link { color: #0066cc; text-decoration: none; }
		.recipe-link:hover { text-decoration: underline; }
		.rating { color: #f39c12; }
	</style>
</head>
<body>
	<h1>Recipe Overview</h1>
	<div class="recipes">`)

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		if err := rows.Scan(&id, &title, &avgRating); err != nil {
			continue
		}

		title = html.EscapeString(title)
		id = html.EscapeString(id)

		ratingText := "No ratings yet"
		if avgRating.Valid {
			ratingText = fmt.Sprintf("★ %.1f", avgRating.Float64)
		}

		htmlContent.WriteString(fmt.Sprintf(`
		<div class="recipe-item">
			<div class="recipe-title">%s</div>
			<div class="rating">%s</div>
			<a class="recipe-link" href="/recipes/%s">View Recipe</a>
		</div>`, title, ratingText, id))
	}

	htmlContent.WriteString(`
	</div>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	if c.Get("Content-Type") != "application/json" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Content-Type must be application/json"})
	}

	var req UploadRecipeRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if strings.TrimSpace(req.Title) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Title is required"})
	}
	if len(req.Ingredients) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Ingredients are required"})
	}
	if strings.TrimSpace(req.Instructions) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Instructions are required"})
	}

	if len(req.Title) > 200 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Title too long"})
	}
	if len(req.Instructions) > 5000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Instructions too long"})
	}
	for _, ingredient := range req.Ingredients {
		if len(ingredient) > 100 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Ingredient name too long"})
		}
		if strings.TrimSpace(ingredient) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Empty ingredient not allowed"})
		}
	}

	recipeID := uuid.New().String()

	ingredientsJSON, err := json.Marshal(req.Ingredients)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}

	_, err = db.Exec(
		"INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		recipeID, req.Title, string(ingredientsJSON), req.Instructions,
	)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}

	recipe := Recipe{
		ID:           recipeID,
		Title:        req.Title,
		Ingredients:  req.Ingredients,
		Instructions: req.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(fiber.StatusCreated).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	if len(recipeID) > 50 || len(recipeID) == 0 {
		return c.Status(fiber.StatusNotFound).SendString("Recipe not found")
	}

	var title, ingredientsJSON, instructions string
	err := db.QueryRow(
		"SELECT title, ingredients, instructions FROM recipes WHERE id = ?",
		recipeID,
	).Scan(&title, &ingredientsJSON, &instructions)

	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Recipe not found")
	}
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	var ingredients []string
	if err := json.Unmarshal([]byte(ingredientsJSON), &ingredients); err != nil {
		log.Printf("JSON parse error: %v", err)
		ingredients = []string{}
	}

	var avgRating sql.NullFloat64
	err = db.QueryRow(
		"SELECT AVG(rating) FROM ratings WHERE recipe_id = ?",
		recipeID,
	).Scan(&avgRating)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("Database error: %v", err)
	}

	rows, err := db.Query(
		"SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC",
		recipeID,
	)
	if err != nil {
		log.Printf("Database error: %v", err)
	}
	defer func() {
		if rows != nil {
			rows.Close()
		}
	}()

	var comments []string
	if rows != nil {
		for rows.Next() {
			var comment string
			if err := rows.Scan(&comment); err == nil {
				comments = append(comments, comment)
			}
		}
	}

	var htmlContent strings.Builder
	htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>`)
	htmlContent.WriteString(html.EscapeString(title))
	htmlContent.WriteString(`</title>
	<meta charset="utf-8">
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		h1 { color: #333; }
		.section { margin: 20px 0; }
		.rating { color: #f39c12; font-size: 1.2em; }
		.ingredient { margin: 5px 0; padding-left: 20px; }
		.comment { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
		.instructions { white-space: pre-wrap; }
	</style>
</head>
<body>
	<h1>`)
	htmlContent.WriteString(html.EscapeString(title))
	htmlContent.WriteString(`</h1>
	
	<div class="section">
		<h2>Rating</h2>
		<div class="rating">`)

	if avgRating.Valid {
		htmlContent.WriteString(fmt.Sprintf("★ %.1f / 5.0", avgRating.Float64))
	} else {
		htmlContent.WriteString("No ratings yet")
	}

	htmlContent.WriteString(`</div>
	</div>
	
	<div class="section">
		<h2>Ingredients</h2>`)

	for _, ingredient := range ingredients {
		htmlContent.WriteString(`<div class="ingredient">• `)
		htmlContent.WriteString(html.EscapeString(ingredient))
		htmlContent.WriteString(`</div>`)
	}

	htmlContent.WriteString(`
	</div>
	
	<div class="section">
		<h2>Instructions</h2>
		<div class="instructions">`)
	htmlContent.WriteString(html.EscapeString(instructions))
	htmlContent.WriteString(`</div>
	</div>
	
	<div class="section">
		<h2>Comments</h2>`)

	if len(comments) == 0 {
		htmlContent.WriteString(`<p>No comments yet</p>`)
	} else {
		for _, comment := range comments {
			htmlContent.WriteString(`<div class="comment">`)
			htmlContent.WriteString(html.EscapeString(comment))
			htmlContent.WriteString(`</div>`)
		}
	}

	htmlContent.WriteString(`
	</div>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent.String())
}

func addComment(c *fiber.Ctx) error {
	if c.Get("Content-Type") != "application/json" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Content-Type must be application/json"})
	}

	recipeID := c.Params("recipeId")

	if len(recipeID) > 50 || len(recipeID) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req AddCommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if strings.TrimSpace(req.Comment) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Comment is required"})
	}
	if len(req.Comment) > 1000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Comment too long"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}
	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	_, err = db.Exec(
		"INSERT INTO comments (recipe_id, comment) VALUES (?, ?)",
		recipeID, req.Comment,
	)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	if c.Get("Content-Type") != "application/json" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Content-Type must be application/json"})
	}

	recipeID := c.Params("recipeId")

	if len(recipeID) > 50 || len(recipeID) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req AddRatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Rating must be between 1 and 5"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}
	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	_, err = db.Exec(
		"INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)",
		recipeID, req.Rating,
	)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Rating added successfully"})
}