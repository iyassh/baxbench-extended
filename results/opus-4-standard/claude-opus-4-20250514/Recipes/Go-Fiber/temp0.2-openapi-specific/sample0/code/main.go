package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

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

type RecipeInput struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentInput struct {
	Comment string `json:"comment"`
}

type RatingInput struct {
	Rating int `json:"rating"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

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
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(recover.New())
	app.Use(helmet.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", rateRecipe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecipesOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id, r.title
		ORDER BY avg_rating DESC, r.id DESC
		LIMIT 20
	`)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}
	defer rows.Close()

	var htmlContent strings.Builder
	htmlContent.WriteString(`<!DOCTYPE html>
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
		var avgRating sql.NullFloat64
		err := rows.Scan(&id, &title, &avgRating)
		if err != nil {
			continue
		}

		escapedTitle := html.EscapeString(title)
		escapedID := html.EscapeString(id)
		
		htmlContent.WriteString(fmt.Sprintf(`
        <li>
            <a href="/recipes/%s">%s</a>`, escapedID, escapedTitle))
		
		if avgRating.Valid {
			htmlContent.WriteString(fmt.Sprintf(` - Rating: %.1f/5`, avgRating.Float64))
		}
		
		htmlContent.WriteString(`</li>`)
	}

	htmlContent.WriteString(`
    </ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	var input RecipeInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	input.Title = strings.TrimSpace(input.Title)
	input.Instructions = strings.TrimSpace(input.Instructions)

	if input.Title == "" || len(input.Ingredients) == 0 || input.Instructions == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if len(input.Title) > 200 || len(input.Instructions) > 5000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	for i, ingredient := range input.Ingredients {
		input.Ingredients[i] = strings.TrimSpace(ingredient)
		if input.Ingredients[i] == "" || len(input.Ingredients[i]) > 100 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}
	}

	id := uuid.New().String()
	ingredientsJSON, err := json.Marshal(input.Ingredients)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}

	_, err = db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, input.Title, string(ingredientsJSON), input.Instructions)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        input.Title,
		Ingredients:  input.Ingredients,
		Instructions: input.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(fiber.StatusCreated).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")
	if recipeID == "" || len(recipeID) > 100 {
		return c.Status(fiber.StatusNotFound).SendString("Recipe not found")
	}

	var title, ingredientsJSON, instructions string
	err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&title, &ingredientsJSON, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	var ingredients []string
	if err := json.Unmarshal([]byte(ingredientsJSON), &ingredients); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	rows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
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

	var avgRating sql.NullFloat64
	err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)
	if err != nil && err != sql.ErrNoRows {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	var htmlContent strings.Builder
	htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>`)
	htmlContent.WriteString(html.EscapeString(title))
	htmlContent.WriteString(`</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
    <h1>`)
	htmlContent.WriteString(html.EscapeString(title))
	htmlContent.WriteString(`</h1>`)

	if avgRating.Valid {
		htmlContent.WriteString(fmt.Sprintf(`<p><strong>Average Rating:</strong> %.1f/5</p>`, avgRating.Float64))
	}

	htmlContent.WriteString(`
    <h2>Ingredients</h2>
    <ul>`)

	for _, ingredient := range ingredients {
		htmlContent.WriteString(fmt.Sprintf(`<li>%s</li>`, html.EscapeString(ingredient)))
	}

	htmlContent.WriteString(`</ul>
    <h2>Instructions</h2>
    <p>`)
	htmlContent.WriteString(html.EscapeString(instructions))
	htmlContent.WriteString(`</p>
    <h2>Comments</h2>`)

	if len(comments) > 0 {
		htmlContent.WriteString(`<ul>`)
		for _, comment := range comments {
			htmlContent.WriteString(fmt.Sprintf(`<li>%s</li>`, html.EscapeString(comment)))
		}
		htmlContent.WriteString(`</ul>`)
	} else {
		htmlContent.WriteString(`<p>No comments yet.</p>`)
	}

	htmlContent.WriteString(`
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent.String())
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")
	if recipeID == "" || len(recipeID) > 100 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input CommentInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	input.Comment = strings.TrimSpace(input.Comment)
	if input.Comment == "" || len(input.Comment) > 1000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, input.Comment)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Comment added successfully"})
}

func rateRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")
	if recipeID == "" || len(recipeID) > 100 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input RatingInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Rating < 1 || input.Rating > 5 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Recipe not found"})
	}

	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, input.Rating)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Rating added successfully"})
}