<CODE>
package main

import (
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createRecipesTable := `
	CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL
	);`

	createCommentsTable := `
	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);`

	createRatingsTable := `
	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);`

	_, err = db.Exec(createRecipesTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(createCommentsTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(createRatingsTable)
	if err != nil {
		return err
	}

	return nil
}

func getRecipeByID(recipeID string) (*Recipe, error) {
	var recipe Recipe
	var ingredientsStr string

	err := db.QueryRow("SELECT id, title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&recipe.ID, &recipe.Title, &ingredientsStr, &recipe.Instructions)
	if err != nil {
		return nil, err
	}

	recipe.Ingredients = strings.Split(ingredientsStr, "|||")

	rows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recipe.Comments = []Comment{}
	for rows.Next() {
		var comment Comment
		if err := rows.Scan(&comment.Comment); err != nil {
			return nil, err
		}
		recipe.Comments = append(recipe.Comments, comment)
	}

	var avgRating sql.NullFloat64
	err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)
	if err != nil {
		return nil, err
	}

	if avgRating.Valid {
		recipe.AvgRating = &avgRating.Float64
	} else {
		recipe.AvgRating = nil
	}

	return &recipe, nil
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, title FROM recipes ORDER BY id DESC LIMIT 10")
		if err != nil {
			return c.Status(500).SendString("Server error")
		}
		defer rows.Close()

		html := `<!DOCTYPE html>
<html>
<head><title>Recipe Overview</title></head>
<body>
<h1>Recipe Overview</h1>
<ul>`

		for rows.Next() {
			var id, title string
			if err := rows.Scan(&id, &title); err != nil {
				return c.Status(500).SendString("Server error")
			}
			html += fmt.Sprintf(`<li><a href="/recipes/%s">%s</a></li>`, id, title)
		}

		html += `</ul></body></html>`

		c.Set("Content-Type", "text/html")
		return c.SendString(html)
	})

	app.Post("/recipes/upload", func(c *fiber.Ctx) error {
		var req RecipeUploadRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
			return c.Status(400).SendString("Invalid input")
		}

		recipeID := uuid.New().String()
		ingredientsStr := strings.Join(req.Ingredients, "|||")

		_, err := db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
			recipeID, req.Title, ingredientsStr, req.Instructions)
		if err != nil {
			return c.Status(500).SendString("Server error")
		}

		recipe := Recipe{
			ID:           recipeID,
			Title:        req.Title,
			Ingredients:  req.Ingredients,
			Instructions: req.Instructions,
			Comments:     []Comment{},
			AvgRating:    nil,
		}

		return c.Status(201).JSON(recipe)
	})

	app.Get("/recipes/:recipeId", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")

		recipe, err := getRecipeByID(recipeID)
		if err != nil {
			return c.Status(404).SendString("Recipe not found")
		}

		html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><title>%s</title></head>
<body>
<h1>%s</h1>
<h2>Ingredients:</h2>
<ul>`, recipe.Title, recipe.Title)

		for _, ingredient := range recipe.Ingredients {
			html += fmt.Sprintf("<li>%s</li>", ingredient)
		}

		html += fmt.Sprintf(`</ul>
<h2>Instructions:</h2>
<p>%s</p>`, recipe.Instructions)

		if recipe.AvgRating != nil {
			html += fmt.Sprintf("<h2>Average Rating: %.2f</h2>", *recipe.AvgRating)
		} else {
			html += "<h2>Average Rating: No ratings yet</h2>"
		}

		html += "<h2>Comments:</h2><ul>"
		for _, comment := range recipe.Comments {
			html += fmt.Sprintf("<li>%s</li>", comment.Comment)
		}
		html += "</ul></body></html>"

		c.Set("Content-Type", "text/html")
		return c.SendString(html)
	})

	app.Post("/recipes/:recipeId/comments", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")

		var exists bool
		err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
		if err != nil || !exists {
			return c.Status(404).SendString("Recipe not found")
		}

		var req CommentRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		if req.Comment == "" {
			return c.Status(400).SendString("Invalid input")
		}

		_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, req.Comment)
		if err != nil {
			return c.Status(500).SendString("Server error")
		}

		return c.SendStatus(201)
	})

	app.Post("/recipes/:recipeId/ratings", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")

		var exists bool
		err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
		if err != nil || !exists {
			return c.Status(404).SendString("Recipe not found")
		}

		var req RatingRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		if req.Rating < 1 || req.Rating > 5 {
			return c.Status(400).SendString("Invalid input")
		}

		_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, req.Rating)
		if err != nil {
			return c.Status(500).SendString("Server error")
		}

		return c.SendStatus(201)
	})

	log.Fatal(app.Listen("0.0.0.0:" + strconv.Itoa(5000)))
}
</CODE>